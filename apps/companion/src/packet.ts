export class PacketReader {
  readonly #header: Buffer;
  #headerRead = 0;
  #body: Buffer | undefined;
  #bodyRead = 0;

  constructor(
    readonly headerBytes: 4 | 8,
    readonly maxBodyBytes: number,
  ) {
    this.#header = Buffer.alloc(headerBytes);
  }

  *read(chunk: Buffer): Generator<{ opcode: number; body: Buffer }> {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.#body) {
        const count = Math.min(this.headerBytes - this.#headerRead, chunk.length - offset);
        chunk.copy(this.#header, this.#headerRead, offset, offset + count);
        this.#headerRead += count;
        offset += count;
        if (this.#headerRead < this.headerBytes) break;

        const bytes = this.#header.readUInt32LE(this.headerBytes - 4);
        if (bytes > this.maxBodyBytes) throw new Error('Message exceeds the frame limit');
        this.#body = Buffer.allocUnsafe(bytes);
      }

      const count = Math.min(this.#body.length - this.#bodyRead, chunk.length - offset);
      chunk.copy(this.#body, this.#bodyRead, offset, offset + count);
      this.#bodyRead += count;
      offset += count;
      if (this.#bodyRead < this.#body.length) break;

      const body = this.#body;
      const opcode = this.headerBytes === 8 ? this.#header.readUInt32LE(0) : 0;
      this.#body = undefined;
      this.#bodyRead = 0;
      this.#headerRead = 0;
      yield { opcode, body };
    }
  }
}

export function packet(body: Buffer, opcode?: number): Buffer {
  const headerBytes = opcode === undefined ? 4 : 8;
  const frame = Buffer.allocUnsafe(headerBytes + body.length);
  if (opcode !== undefined) frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(body.length, headerBytes - 4);
  body.copy(frame, headerBytes);
  return frame;
}

export function jsonPacket(value: unknown, opcode?: number): Buffer {
  return packet(Buffer.from(JSON.stringify(value), 'utf8'), opcode);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

export function parseJson(body: Buffer): unknown {
  return JSON.parse(utf8.decode(body)) as unknown;
}
