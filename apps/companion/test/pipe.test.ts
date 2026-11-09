import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import type { NativeStatus } from '@tubepulse/shared';
import { expect, it, vi } from 'vitest';

import { serveChrome } from '../src/host.js';
import { jsonPacket, PacketReader, parseJson } from '../src/packet.js';
import { PresenceSession } from '../src/session.js';

it('publishes framed Chrome activity over a real local pipe and clears it on browser EOF', async () => {
  const name = `tubepulse-test-${randomUUID()}`;
  const address = process.platform === 'win32' ? `\\\\?\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
  const observed = new EventEmitter();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      observed.emit('disconnect');
    });
    const reader = new PacketReader(8, 16 * 1024);
    socket.on('data', (chunk: Buffer) => {
      for (const { opcode, body } of reader.read(chunk)) {
        if (opcode === 0) {
          observed.emit('handshake', parseJson(body));
          socket.write(jsonPacket({ cmd: 'DISPATCH', evt: 'READY' }, 1));
        } else if (opcode === 1) {
          const { cmd, nonce, args } = parseJson(body) as {
            cmd: string;
            nonce: string;
            args: { pid: number; activity: unknown };
          };
          socket.write(jsonPacket({ cmd, nonce, evt: null }, 1));
          observed.emit('activity', args);
        }
      }
    });
  });
  await once(server.listen(address), 'listening');

  const input = new PassThrough();
  const output = new PassThrough();
  const status = vi.fn((message: NativeStatus) => {
    if (message.published) observed.emit('published', message);
  });
  const report = vi.fn();
  const applicationId = '123456789012345678';
  const handshake = once(observed, 'handshake');
  const publication = once(observed, 'activity');
  const confirmation = once(observed, 'published');
  const session = new PresenceSession(applicationId, status, () => createConnection(address));
  const stop = serveChrome(input, output, session, report);
  try {
    input.write(
      jsonPacket({
        v: 1,
        type: 'activity',
        activity: { kind: 'video', state: 'playing', title: 'Pipe test' },
      }),
    );
    expect(await handshake).toEqual([{ v: 1, client_id: applicationId }]);
    expect(await publication).toEqual([
      { pid: process.pid, activity: { type: 3, details: 'Pipe test' } },
    ]);
    expect(await confirmation).toEqual([{ v: 1, type: 'status', discord: 'ready', published: true }]);

    const clear = once(observed, 'activity');
    const disconnect = once(observed, 'disconnect');
    input.end();
    expect(await clear).toEqual([{ pid: process.pid, activity: null }]);
    await disconnect;
    expect(report).not.toHaveBeenCalled();
  } finally {
    stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
