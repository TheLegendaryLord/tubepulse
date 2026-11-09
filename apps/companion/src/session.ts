import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';

import { PROTOCOL_VERSION, type NativeStatus, type PublicActivity } from '@tubepulse/shared';

import { hidesChannelWithPausedLabel, toDiscordActivity, type DiscordActivity } from './activity.js';
import { jsonPacket, packet, PacketReader, parseJson } from './packet.js';

const opcode = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 };
const maxPipes = 10;
const connectTimeoutMs = 2_000;
const handshakeTimeoutMs = 4_000;
const commandTimeoutMs = 2_500;
const leaseMs = 35_000;
const publishIntervalMs = 4_100;
const initialRetryMs = 1_000;
const maxRetryMs = 30_000;

type Phase = 'idle' | 'connecting' | 'ready' | 'stopping' | 'stopped';
type StatusSink = (message: NativeStatus) => void;
type SocketFactory = (index: number) => Socket;

function openDiscordPipe(index: number): Socket {
  return createConnection(`\\\\?\\pipe\\discord-ipc-${index}`);
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function equivalent(previous: DiscordActivity | null, desired: DiscordActivity | null): boolean {
  if (!previous || !desired) return previous === desired;
  const { timestamps: oldTime, ...oldFields } = previous;
  const { timestamps: newTime, ...newFields } = desired;
  if (JSON.stringify(oldFields) !== JSON.stringify(newFields)) return false;
  if (!oldTime || !newTime) return oldTime === newTime;
  // A heartbeat with sub-second drift should not reset Discord's timer.
  return (
    Math.abs(oldTime.start - newTime.start) <= 1 &&
    (oldTime.end !== undefined && newTime.end !== undefined
      ? Math.abs(oldTime.end - newTime.end) <= 1
      : oldTime.end === newTime.end)
  );
}

function removesFields(previous: DiscordActivity | null, desired: DiscordActivity): boolean {
  return Boolean(
    (previous?.details && !desired.details) ||
    (previous?.state && !desired.state) ||
    hidesChannelWithPausedLabel(previous?.state, desired.state) ||
    (previous?.buttons && !desired.buttons) ||
    (previous?.assets && !desired.assets) ||
    (previous?.timestamps && !desired.timestamps),
  );
}

export class PresenceSession {
  #phase: Phase = 'idle';
  #socket: Socket | undefined;
  #desired: DiscordActivity | null = null;
  #published: DiscordActivity | null = null;
  #possiblyActive = false;
  #lastSend = -Infinity;
  #lastStatus: NativeStatus | undefined;
  #pending: { nonce: string; activity: DiscordActivity | null } | undefined;
  #connectionTimer: NodeJS.Timeout | undefined;
  #publishTimer: NodeJS.Timeout | undefined;
  #replyTimer: NodeJS.Timeout | undefined;
  #leaseTimer: NodeJS.Timeout | undefined;
  #retryDelay = initialRetryMs;

  constructor(
    private readonly applicationId: string,
    private readonly notify: StatusSink,
    private readonly openPipe: SocketFactory = openDiscordPipe,
  ) {}

  start(): void {
    if (this.#phase !== 'idle') return;
    this.#phase = 'connecting';
    this.#status('connecting');
    this.#probe(0);
  }

  setActivity(activity: PublicActivity | null): void {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return;
    clearTimeout(this.#leaseTimer);
    this.#desired = activity ? toDiscordActivity(activity) : null;
    if (activity) this.#leaseTimer = setTimeout(() => this.setActivity(null), leaseMs);
    this.#pump();
  }

  stop(): void {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return;
    clearTimeout(this.#leaseTimer);
    this.#desired = null;
    if (this.#phase !== 'ready') {
      this.#finish();
      return;
    }
    this.#phase = 'stopping';
    this.#pump();
  }

  #status(discord: NativeStatus['discord'], detail?: string): void {
    const status: NativeStatus = { v: PROTOCOL_VERSION, type: 'status', discord };
    if (detail) status.detail = detail;
    if (discord === 'ready') status.published = this.#published !== null;
    if (
      this.#lastStatus?.discord === status.discord &&
      this.#lastStatus.detail === status.detail &&
      this.#lastStatus.published === status.published
    ) {
      return;
    }
    this.#lastStatus = status;
    this.notify(status);
  }

  #probe(index: number, handshakeFailed = false): void {
    if (this.#phase !== 'connecting') return;
    if (index === maxPipes) {
      if (handshakeFailed) {
        this.#status('error', 'Discord did not accept the IPC handshake. Verify the Application ID.');
      }
      this.#scheduleReconnect();
      return;
    }

    const socket = this.openPipe(index);
    this.#socket = socket;
    let connected = false;
    const lost = () => {
      if (this.#socket !== socket) return;
      if (this.#phase !== 'connecting') {
        this.#connectionLost();
        return;
      }
      this.#releaseSocket();
      this.#probe(index + 1, handshakeFailed || connected);
    };

    const reader = new PacketReader(8, 1024 * 1024);
    this.#connectionTimer = setTimeout(lost, connectTimeoutMs);
    socket.once('connect', () => {
      if (this.#socket !== socket) return;
      connected = true;
      clearTimeout(this.#connectionTimer);
      this.#connectionTimer = setTimeout(lost, handshakeTimeoutMs);
      socket.write(jsonPacket({ v: 1, client_id: this.applicationId }, opcode.handshake));
    });
    socket.on('error', lost);
    socket.once('close', lost);
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const { opcode: code, body } of reader.read(chunk)) {
          if (this.#socket !== socket) break;
          if (code === opcode.close) {
            lost();
          } else if (code === opcode.ping) {
            socket.write(packet(body, opcode.pong));
          } else if (code === opcode.frame) {
            const message = object(parseJson(body));
            if (!message) throw new Error('Invalid Discord response');
            this.#receive(message);
          }
        }
      } catch {
        lost();
      }
    });
  }

  #receive(message: Record<string, unknown>): void {
    if (this.#phase === 'connecting' && message.cmd === 'DISPATCH' && message.evt === 'READY') {
      clearTimeout(this.#connectionTimer);
      this.#phase = 'ready';
      this.#status('ready');
      this.#pump();
      return;
    }

    if (!this.#pending || message.nonce !== this.#pending.nonce) return;
    if (message.evt === 'ERROR') {
      const code = object(message.data)?.code;
      const description = Number.isInteger(code) ? ` (RPC code ${String(code)})` : '';
      this.#connectionLost(`Discord rejected the activity${description}.`);
      return;
    }
    if (message.cmd !== 'SET_ACTIVITY') return;
    this.#published = this.#pending.activity;
    this.#possiblyActive = this.#published !== null;
    this.#pending = undefined;
    clearTimeout(this.#replyTimer);
    this.#retryDelay = initialRetryMs;
    if (this.#phase === 'ready') this.#status('ready');
    this.#pump();
  }

  #pump(): void {
    if ((this.#phase !== 'ready' && this.#phase !== 'stopping') || this.#pending) return;

    clearTimeout(this.#publishTimer);
    const clearUnconfirmedActivity = this.#desired === null && this.#possiblyActive;
    if (!clearUnconfirmedActivity && equivalent(this.#published, this.#desired)) {
      if (this.#phase === 'stopping') this.#finish();
      return;
    }

    const now = performance.now();
    const delay = this.#lastSend + publishIntervalMs - now;
    if (this.#desired && !removesFields(this.#published, this.#desired) && delay > 0) {
      this.#publishTimer = setTimeout(() => this.#pump(), Math.ceil(delay));
      return;
    }

    const activity = this.#desired;
    const nonce = randomUUID();
    this.#lastSend = now;
    this.#pending = { nonce, activity };
    if (activity) this.#possiblyActive = true;
    this.#replyTimer = setTimeout(
      () => this.#connectionLost('Discord did not acknowledge the activity update.'),
      commandTimeoutMs,
    );
    this.#socket?.write(
      jsonPacket({ cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce }, opcode.frame),
    );
  }

  #connectionLost(detail?: string): void {
    if (this.#phase === 'stopping') {
      this.#finish();
      return;
    }

    this.#releaseSocket();
    this.#phase = 'connecting';
    if (detail) this.#status('error', detail);
    else this.#status('connecting', 'Waiting for Discord Desktop.');
    this.#scheduleReconnect();
  }

  #scheduleReconnect(): void {
    this.#connectionTimer = setTimeout(() => this.#probe(0), this.#retryDelay);
    this.#retryDelay = Math.min(this.#retryDelay * 2, maxRetryMs);
  }

  #releaseSocket(): void {
    clearTimeout(this.#connectionTimer);
    clearTimeout(this.#publishTimer);
    clearTimeout(this.#replyTimer);
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.destroy();
    this.#pending = undefined;
    this.#published = null;
  }

  #finish(): void {
    this.#phase = 'stopped';
    this.#releaseSocket();
  }
}
