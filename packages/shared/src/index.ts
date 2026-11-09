import { z } from 'zod';

export const NATIVE_HOST = 'com.tubepulse.host';
export const PROTOCOL_VERSION = 1;
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// eslint-disable-next-line no-control-regex -- Reject control characters at the native boundary.
const controlCharacters = /[\u0000-\u001f\u007f]/u;
const text = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !controlCharacters.test(value));
const unixMilliseconds = z.number().int().min(1).max(8_640_000_000_000_000);

const timestampsSchema = z
  .strictObject({ start: unixMilliseconds, end: unixMilliseconds.optional() })
  .refine(({ start, end }) => end === undefined || end > start, 'End must be after start');

export const publicActivitySchema = z
  .strictObject({
    kind: z.enum(['video', 'short', 'music', 'live']),
    state: z.enum(['playing', 'paused']),
    title: text.optional(),
    channel: text.optional(),
    videoId: z.string().regex(VIDEO_ID).optional(),
    link: z.boolean().optional(),
    thumbnail: z.boolean().optional(),
    timestamps: timestampsSchema.optional(),
  })
  .refine(
    ({ videoId, link, thumbnail }) => Boolean(videoId) === Boolean(link || thumbnail),
    'A video ID is required only when sharing a link or thumbnail',
  )
  .refine(
    ({ state, timestamps }) => state === 'playing' || !timestamps,
    'Paused activity cannot include a running clock',
  );

export const nativeCommandSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('activity'),
  activity: publicActivitySchema.nullable(),
});

export const nativeStatusSchema = z
  .strictObject({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('status'),
    discord: z.enum(['disabled', 'connecting', 'ready', 'error']),
    detail: z.string().trim().min(1).max(240).optional(),
    published: z.boolean().optional(),
  })
  .refine(({ discord, published }) => discord === 'ready' || published === undefined);

export type PublicActivity = z.infer<typeof publicActivitySchema>;
export type NativeCommand = z.infer<typeof nativeCommandSchema>;
export type NativeStatus = z.infer<typeof nativeStatusSchema>;
