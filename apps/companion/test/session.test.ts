import { Socket } from 'node:net';

import type { NativeStatus, PublicActivity } from '@tubepulse/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonPacket, packet, parseJson } from '../src/packet.js';
import { PresenceSession } from '../src/session.js';

const appId = '123456789012345678';
const video: PublicActivity = {
  kind: 'video',
  state: 'playing',
  title: 'Original video',
  timestamps: { start: 1_700_000_000_000, end: 1_700_000_090_000 },
};
const ready = jsonPacket({ cmd: 'DISPATCH', evt: 'READY' }, 1);

type ActivityCommand = { cmd: string; nonce: string; args: { pid: number; activity: unknown } };

function harness() {
  const sockets: Socket[] = [];
  const statuses: NativeStatus[] = [];
  const openPipe = vi.fn<(index: number) => Socket>(() => {
    const socket = new Socket();
    vi.spyOn(socket, 'write').mockReturnValue(true);
    sockets.push(socket);
    return socket;
  });
  const session = new PresenceSession(appId, (status) => statuses.push(status), openPipe);
  session.start();
  return { session, sockets, statuses, openPipe };
}

function writes(socket: Socket): Buffer[] {
  return vi.mocked(socket.write).mock.calls.map(([data]) => data as Buffer);
}

function commands(socket: Socket): ActivityCommand[] {
  return writes(socket)
    .filter((bytes) => bytes.readUInt32LE(0) === 1)
    .map((frame) => parseJson(frame.subarray(8)) as ActivityCommand);
}

function connect(socket: Socket): void {
  socket.emit('connect');
  socket.emit('data', ready);
}

function acknowledge(socket: Socket): void {
  const { cmd, nonce } = commands(socket).at(-1)!;
  socket.emit('data', jsonPacket({ cmd, nonce, evt: null }, 1));
}

describe('Discord IPC lifecycle', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('waits for READY, responds to fragmented pings, and sends a PID-scoped activity', () => {
    const { session, sockets, statuses } = harness();
    const socket = sockets[0]!;
    session.setActivity(video);
    socket.emit('connect');
    expect(commands(socket)).toEqual([]);
    const handshake = writes(socket)[0]!;
    expect(handshake.readUInt32LE(0)).toBe(0);
    expect(parseJson(handshake.subarray(8))).toEqual({ v: 1, client_id: appId });
    const ping = packet(Buffer.from('ping'), 3);
    socket.emit('data', ping.subarray(0, 6));
    socket.emit('data', Buffer.concat([ping.subarray(6), ready]));
    expect(writes(socket)[1]).toEqual(packet(Buffer.from('ping'), 4));
    expect(statuses.map(({ discord }) => discord)).toEqual(['connecting', 'ready']);
    expect(commands(socket)[0]?.args).toMatchObject({
      pid: process.pid,
      activity: { type: 3, details: 'Original video' },
    });
    acknowledge(socket);
    session.stop();
    expect(commands(socket).at(-1)?.args.activity).toBeNull();
    expect(socket.destroyed).toBe(false);
    acknowledge(socket);
    expect(socket.destroyed).toBe(true);
  });

  it('retries with exponential backoff when Discord is absent and publishes once it starts', () => {
    const { session, sockets, openPipe, statuses } = harness();
    session.setActivity(video);
    const failScan = (offset: number) => {
      for (let index = offset; index < offset + 10; index++) {
        sockets[index]!.emit('error', new Error('No pipe'));
      }
    };
    failScan(0);
    expect(openPipe.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    vi.advanceTimersByTime(1_000);
    failScan(10);
    vi.advanceTimersByTime(1_999);
    expect(sockets).toHaveLength(20);
    vi.advanceTimersByTime(1);
    const socket = sockets[20]!;
    connect(socket);
    expect(statuses.at(-1)?.discord).toBe('ready');
    expect(commands(socket)[0]?.args.activity).toMatchObject({ details: video.title });
  });

  it('replays current presence after restart and clears unconfirmed activity after lease expiration', () => {
    const { session, sockets, statuses } = harness();
    const first = sockets[0]!;
    connect(first);
    session.setActivity(video);
    acknowledge(first);

    first.emit('close');
    expect(statuses.at(-1)?.discord).toBe('connecting');
    vi.advanceTimersByTime(1_000);
    const second = sockets[1]!;
    connect(second);
    vi.advanceTimersByTime(3_100);
    expect(commands(second).at(-1)?.args.activity).toMatchObject({ details: video.title });
    acknowledge(second);
    vi.advanceTimersByTime(35_000 - 4_100);
    expect(commands(second).at(-1)?.args.activity).toBeNull();
    acknowledge(second);

    second.emit('close');
    vi.advanceTimersByTime(1_000);
    const third = sockets[2]!;
    connect(third);
    expect(commands(third)).toEqual([]);
  });

  it('drops an unacknowledged Discord command, then retries and handles privacy clears', () => {
    const { session, sockets, statuses } = harness();
    connect(sockets[0]!);
    session.setActivity(video);
    vi.advanceTimersByTime(2_500);
    expect(statuses.at(-1)?.detail).toContain('acknowledge');
    expect(sockets[0]!.destroyed).toBe(true);

    session.setActivity(null);
    vi.advanceTimersByTime(1_000);
    const second = sockets[1]!;
    connect(second);
    expect(commands(second)[0]?.args.activity).toBeNull();
    acknowledge(second);
    expect(statuses.at(-1)?.discord).toBe('ready');
  });

  it('ignores unrelated replies and reports rejection without exposing server-provided text', () => {
    const { session, sockets, statuses } = harness();
    const socket = sockets[0]!;
    connect(socket);
    session.setActivity(video);
    const { cmd, nonce } = commands(socket)[0]!;
    socket.emit('data', jsonPacket({ cmd, nonce: 'unrelated', evt: null }, 1));
    session.setActivity(null);
    expect(commands(socket)).toHaveLength(1);

    socket.emit(
      'data',
      jsonPacket(
        { cmd, nonce, evt: 'ERROR', data: { code: 4000, message: 'Do not expose this text' } },
        1,
      ),
    );
    expect(statuses.at(-1)).toMatchObject({
      discord: 'error',
      detail: 'Discord rejected the activity (RPC code 4000).',
    });
    expect(socket.destroyed).toBe(true);
  });

  it('coalesces ordinary updates and sends only the latest item after its throttle window', () => {
    const { session, sockets } = harness();
    const socket = sockets[0]!;
    connect(socket);
    session.setActivity(video);
    acknowledge(socket);

    session.setActivity({ ...video, title: 'Skipped item' });
    session.setActivity({ ...video, title: 'Latest item' });
    vi.advanceTimersByTime(4_099);
    expect(commands(socket)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(commands(socket).map(({ args }) => args.activity)).toEqual([
      expect.objectContaining({ details: 'Original video' }),
      expect.objectContaining({ details: 'Latest item' }),
    ]);
    acknowledge(socket);

    session.setActivity({ kind: 'video', state: 'playing' });
    expect(commands(socket).at(-1)?.args.activity).toEqual({ type: 3 });
  });

  it('deduplicates heartbeats and gives cleanup priority over the normal update throttle', () => {
    const { session, sockets } = harness();
    const socket = sockets[0]!;
    connect(socket);
    session.setActivity(video);
    acknowledge(socket);
    vi.advanceTimersByTime(10_000);
    session.setActivity(video);
    vi.advanceTimersByTime(10_000);
    expect(commands(socket)).toHaveLength(1);

    session.setActivity({ ...video, title: 'Different video' });
    session.stop();
    expect(commands(socket)).toHaveLength(2);
    acknowledge(socket);
    expect(commands(socket).at(-1)?.args.activity).toBeNull();
    acknowledge(socket);
    expect(socket.destroyed).toBe(true);
  });

  it('reports only acknowledged presence, deduplicates status, and invalidates it on disconnect', () => {
    const { session, sockets, statuses } = harness();
    const socket = sockets[0]!;
    connect(socket);
    session.setActivity(video);
    expect(statuses.at(-1)).toMatchObject({ discord: 'ready', published: false });
    acknowledge(socket);
    expect(statuses.at(-1)).toMatchObject({ discord: 'ready', published: true });
    const originalStatusCount = statuses.length;
    vi.advanceTimersByTime(4_100);
    session.setActivity({ ...video, title: 'Next video' });
    acknowledge(socket);
    expect(statuses).toHaveLength(originalStatusCount);

    session.setActivity(null);
    expect(statuses.at(-1)).toMatchObject({ published: true });
    acknowledge(socket);
    expect(statuses.at(-1)).toMatchObject({ published: false });

    socket.emit('close');
    expect(statuses.at(-1)?.discord).toBe('connecting');
    expect(statuses.at(-1)).not.toHaveProperty('published');
  });

  it.each(['playing', 'paused'] as const)(
    'removes a hidden channel from %s presence without waiting for the throttle',
    (state) => {
      const { session, sockets } = harness();
      const socket = sockets[0]!;
      connect(socket);
      session.setActivity({ kind: 'video', state, channel: 'Sensitive channel' });
      acknowledge(socket);
      expect(commands(socket).at(-1)?.args.activity).toMatchObject({
        state: state === 'playing' ? 'Sensitive channel' : 'Paused · Sensitive channel',
      });

      session.setActivity({ kind: 'video', state: 'paused' });
      expect(commands(socket).at(-1)?.args.activity).toEqual({ type: 3, state: 'Paused' });
    },
  );
});
