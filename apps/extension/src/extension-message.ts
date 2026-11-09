import { VIDEO_ID } from '@tubepulse/shared';
import { z } from 'zod';
import { cleanText } from './player';

const seconds = z.number().min(0).max(604_800);
const metadataText = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => cleanText(value) === value);
const playbackMessage = z.strictObject({
  type: z.literal('playback'),
  playback: z
    .strictObject({
      kind: z.enum(['video', 'short', 'music']),
      videoId: z.string().regex(VIDEO_ID),
      state: z.enum(['playing', 'paused', 'buffering']),
      live: z.boolean(),
      title: metadataText.optional(),
      channel: metadataText.optional(),
      currentTime: seconds,
      duration: seconds.positive().nullable(),
      rate: z.number().min(0.0625).max(16),
    })
    .nullable(),
});

export function verifyPlaybackMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  extensionId: string,
) {
  const tabId = sender.tab?.id;
  if (
    sender.id !== extensionId ||
    sender.frameId !== 0 ||
    sender.documentLifecycle !== 'active' ||
    !sender.documentId ||
    tabId === undefined ||
    (sender.origin !== 'https://www.youtube.com' && sender.origin !== 'https://music.youtube.com') ||
    !sender.url?.startsWith(`${sender.origin}/`)
  )
    return undefined;

  const parsed = playbackMessage.safeParse(message);
  if (!parsed.success) return undefined;
  const playback = parsed.data.playback;
  // Chrome may keep the document's original sender URL through pushState navigation.
  // The isolated script checks the live route, while Chrome authenticates its origin and document.
  if (playback && (playback.kind === 'music') !== (sender.origin === 'https://music.youtube.com'))
    return undefined;
  return { tabId, documentId: sender.documentId, playback };
}
