import type { Readable, Writable } from 'node:stream';

import { nativeCommandSchema } from '@tubepulse/shared';

import { PacketReader, parseJson } from './packet.js';
import type { PresenceSession } from './session.js';

type Session = Pick<PresenceSession, 'start' | 'setActivity' | 'stop'>;

export function serveChrome(
  input: Readable,
  output: Writable,
  session: Session,
  report: (reason: string) => void,
): () => void {
  let closed = false;
  const reader = new PacketReader(4, 16 * 1024);

  const close = () => {
    if (closed) return;
    closed = true;
    input.destroy();
    session.stop();
  };

  input.on('data', (chunk: Buffer) => {
    if (closed) return;
    try {
      for (const { body } of reader.read(chunk)) {
        const result = nativeCommandSchema.safeParse(parseJson(body));
        if (!result.success) throw new Error('Invalid command');
        session.setActivity(result.data.activity);
      }
    } catch {
      report('Rejected an invalid native message.');
      close();
    }
  });

  input.once('end', close);
  input.once('close', close);
  input.on('error', () => {
    report('The Chrome input pipe failed.');
    close();
  });
  output.on('error', () => {
    report('The Chrome output pipe failed.');
    close();
  });
  session.start();
  return close;
}
