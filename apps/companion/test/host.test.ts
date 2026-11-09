import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { toDiscordActivity } from '../src/activity.js';
import { validateConfig } from '../src/config.js';
import { serveChrome } from '../src/host.js';
import { jsonPacket, packet, PacketReader, parseJson } from '../src/packet.js';

describe('native messaging', () => {
  it('accepts only the exact configured extension origin and a snowflake string', () => {
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
    const config = { extensionId, discordApplicationId: '123456789012345678' };
    const origin = `chrome-extension://${extensionId}/`;
    expect(validateConfig(config, origin)).toEqual(config);
    expect(() => validateConfig(config, origin + 'popup.html')).toThrow(/origin/);
    expect(() => validateConfig(config, undefined)).toThrow(/origin/);
    expect(() => validateConfig({ ...config, discordApplicationId: 123 }, origin)).toThrow(
      /Application ID/,
    );
    expect(() =>
      validateConfig({ ...config, discordApplicationId: '99999999999999999999' }, origin),
    ).toThrow(/Application ID/);
  });

  it('decodes fragmented and batched frames, including zero-length Discord pings', () => {
    const reader = new PacketReader(8, 1024);
    const ping = packet(Buffer.alloc(0), 3);
    const message = jsonPacket({ type: 'packet', value: 'Привет' }, 1);
    expect([...reader.read(ping.subarray(0, 2))]).toEqual([]);
    const frames = [...reader.read(Buffer.concat([ping.subarray(2), message]))];
    expect(frames.map(({ opcode }) => opcode)).toEqual([3, 1]);
    expect(frames[0]?.body).toHaveLength(0);
    expect(parseJson(frames[1]!.body)).toEqual({ type: 'packet', value: 'Привет' });
  });

  it('rejects oversize lengths before allocating their payload', () => {
    const reader = new PacketReader(4, 64);
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32LE(0xffffffff);
    expect(() => [...reader.read(oversized)]).toThrow(/frame limit/);
  });

  it('passes a validated stream to the session and stops on EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const session = { start: vi.fn(), setActivity: vi.fn(), stop: vi.fn() };
    const report = vi.fn();
    serveChrome(input, output, session, report);
    expect(session.start).toHaveBeenCalledOnce();

    const message = jsonPacket({
      v: 1,
      type: 'activity',
      activity: { kind: 'video', state: 'playing' },
    });
    input.write(message.subarray(0, 3));
    expect(session.setActivity).not.toHaveBeenCalled();
    input.write(message.subarray(3));
    expect(session.setActivity).toHaveBeenCalledWith({ kind: 'video', state: 'playing' });

    const closed = new Promise<void>((resolve) => input.once('close', resolve));
    input.end(jsonPacket({ v: 1, type: 'activity', activity: null }));
    await closed;
    expect(session.setActivity).toHaveBeenLastCalledWith(null);
    expect(session.stop).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it('shuts down on invalid input without logging metadata', () => {
    const input = new PassThrough();
    const session = { start: vi.fn(), setActivity: vi.fn(), stop: vi.fn() };
    const report = vi.fn();
    serveChrome(input, new PassThrough(), session, report);
    input.write(jsonPacket({ v: 2, type: 'activity', activity: { title: 'Sensitive title' } }));
    expect(report).toHaveBeenCalledWith('Rejected an invalid native message.');
    expect(session.setActivity).not.toHaveBeenCalled();
    expect(session.stop).toHaveBeenCalledOnce();
  });
});

describe('Discord activity payloads', () => {
  const timestamps = { start: 1_700_000_000_500, end: 1_700_000_060_500 };

  it('uses Watching and canonical thumbnails and links without playlist or tracking parameters', () => {
    expect(
      toDiscordActivity({
        kind: 'short',
        state: 'playing',
        videoId: 'dQw4w9WgXcQ',
        title: 'Video title',
        channel: 'Channel name',
        link: true,
        thumbnail: true,
        timestamps,
      }),
    ).toEqual({
      type: 3,
      details: 'Video title',
      state: 'Channel name',
      timestamps: { start: 1_700_000_000, end: 1_700_000_061 },
      buttons: [{ label: 'Watch on YouTube', url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' }],
      assets: { large_image: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
    });
  });

  it('uses Listening for music and withholds time and hidden fields while paused', () => {
    expect(toDiscordActivity({ kind: 'music', state: 'paused', timestamps })).toEqual({
      type: 2,
      state: 'Paused',
    });
    expect(
      toDiscordActivity({
        kind: 'video',
        state: 'playing',
        videoId: 'dQw4w9WgXcQ',
        link: false,
        thumbnail: false,
      }),
    ).toEqual({ type: 3 });
  });

  it('keeps text within the IPC field limit without splitting a Unicode character', () => {
    const details = toDiscordActivity({
      kind: 'video',
      state: 'playing',
      title: '🧪'.repeat(80),
    }).details;
    expect(details).toBe('🧪'.repeat(32));
  });
});
