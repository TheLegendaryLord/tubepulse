import type { PublicActivity } from '@tubepulse/shared';

export interface DiscordActivity {
  type: 2 | 3;
  details?: string;
  state?: string;
  timestamps?: { start: number; end?: number };
  buttons?: [{ label: string; url: string }];
  assets?: { large_image: string };
}

const PAUSED = 'Paused';
const pausedPrefix = `${PAUSED} · `;

export function hidesChannelWithPausedLabel(previous?: string, desired?: string): boolean {
  return desired === PAUSED && previous !== undefined && previous !== PAUSED;
}

function discordText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const characters = [...value.trim()];
  let text = '';
  let bytes = 0;
  for (const character of characters) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > 128) break;
    text += character;
  }
  return text.length >= 2 ? text : undefined;
}

export function toDiscordActivity(input: PublicActivity): DiscordActivity {
  const details = discordText(input.title);
  const channel = discordText(input.channel);
  const state =
    input.state === 'paused' ? discordText(channel ? `${pausedPrefix}${channel}` : PAUSED) : channel;
  const activity: DiscordActivity = { type: input.kind === 'music' ? 2 : 3 };
  if (details) activity.details = details;
  if (state) activity.state = state;
  if (input.state === 'playing' && input.timestamps) {
    // The local RPC command takes Unix seconds. Gateway activity events use milliseconds.
    activity.timestamps = { start: Math.floor(input.timestamps.start / 1000) };
    if (input.timestamps.end !== undefined) {
      activity.timestamps.end = Math.ceil(input.timestamps.end / 1000);
    }
  }

  if (input.videoId && input.link) {
    const url =
      input.kind === 'short'
        ? `https://www.youtube.com/shorts/${input.videoId}`
        : `https://${input.kind === 'music' ? 'music' : 'www'}.youtube.com/watch?v=${input.videoId}`;
    activity.buttons = [{ label: 'Watch on YouTube', url }];
  }
  if (input.videoId && input.thumbnail) {
    activity.assets = { large_image: `https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg` };
  }
  return activity;
}
