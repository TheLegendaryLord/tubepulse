import { describe, expect, it } from 'vitest';
import { nativeCommandSchema, nativeStatusSchema, publicActivitySchema } from './index';

const activity = { kind: 'video', state: 'playing' };
const videoId = 'dQw4w9WgXcQ';

describe('native protocol', () => {
  it('accepts only the supported command and version, including an explicit clear', () => {
    expect(nativeCommandSchema.safeParse({ v: 1, type: 'activity', activity: null }).success).toBe(true);
    expect(nativeCommandSchema.safeParse({ v: 2, type: 'activity', activity: null }).success).toBe(
      false,
    );
    expect(nativeCommandSchema.safeParse({ v: 1, type: 'launch', activity: null }).success).toBe(false);
    expect(
      nativeCommandSchema.safeParse({ v: 1, type: 'activity', activity: null, debug: true }).success,
    ).toBe(false);
  });

  it('keeps private activity free of identifying data and bounds public metadata', () => {
    expect(publicActivitySchema.parse(activity)).toEqual(activity);
    expect(publicActivitySchema.safeParse({ ...activity, videoId }).success).toBe(false);
    expect(publicActivitySchema.safeParse({ ...activity, videoId, thumbnail: true }).success).toBe(true);
    expect(publicActivitySchema.safeParse({ ...activity, link: true }).success).toBe(false);
    expect(
      publicActivitySchema.safeParse({ ...activity, videoId: 'https://evil.example', link: true })
        .success,
    ).toBe(false);
    expect(publicActivitySchema.safeParse({ ...activity, url: 'https://example.com' }).success).toBe(
      false,
    );
    expect(publicActivitySchema.safeParse({ ...activity, title: 'a'.repeat(129) }).success).toBe(false);
  });

  it('rejects malformed clocks, including a running clock on paused activity', () => {
    const timestamps = { start: 1_800_000_000_000, end: 1_800_000_060_000 };
    expect(publicActivitySchema.safeParse({ ...activity, timestamps }).success).toBe(true);
    expect(publicActivitySchema.safeParse({ ...activity, state: 'paused', timestamps }).success).toBe(
      false,
    );
    expect(
      publicActivitySchema.safeParse({ ...activity, timestamps: { start: 99, end: 2 } }).success,
    ).toBe(false);
    expect(
      publicActivitySchema.safeParse({ ...activity, timestamps: { start: Infinity } }).success,
    ).toBe(false);
  });

  it('limits native status to the public connection state', () => {
    expect(nativeStatusSchema.safeParse({ v: 1, type: 'status', discord: 'ready' }).success).toBe(true);
    expect(
      nativeStatusSchema.safeParse({ v: 1, type: 'status', discord: 'ready', published: true }).success,
    ).toBe(true);
    expect(
      nativeStatusSchema.safeParse({ v: 1, type: 'status', discord: 'error', published: true }).success,
    ).toBe(false);
    expect(
      nativeStatusSchema.safeParse({ v: 1, type: 'status', discord: 'ready', user: {} }).success,
    ).toBe(false);
  });
});
