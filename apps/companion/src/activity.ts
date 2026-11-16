import type { PublicActivity } from '@tubepulse/shared';

export interface DiscordActivity {
  type: 2 | 3;
  details?: string;
  details_url?: string;
  status_display_type?: 2;
  state?: string;
  timestamps?: { start: number; end?: number };
  buttons?: [{ label: string; url: string }];
  assets?: { large_image: string; large_text: string; large_url?: string };
}

const PAUSED = 'Paused';
const LIVE = 'Live';
const media = {
  video: { button: 'Watch on YouTube', artwork: 'YouTube video thumbnail' },
  short: { button: 'Watch on YouTube Shorts', artwork: 'YouTube Shorts thumbnail' },
  music: { button: 'Listen on YouTube Music', artwork: 'YouTube Music artwork' },
  live: { button: 'Watch live on YouTube', artwork: 'YouTube live stream thumbnail' },
} satisfies Record<PublicActivity['kind'], { button: string; artwork: string }>;

export function hidesChannelWithPlaybackLabel(previous?: string, desired?: string): boolean {
  return (
    (desired === PAUSED || desired === LIVE) &&
    previous !== undefined &&
    previous !== PAUSED &&
    previous !== LIVE
  );
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

function videoUrl(kind: PublicActivity['kind'], videoId: string): string {
  if (kind === 'short') return `https://www.youtube.com/shorts/${videoId}`;
  const host = kind === 'music' ? 'music.youtube.com' : 'www.youtube.com';
  return `https://${host}/watch?v=${videoId}`;
}

export function toDiscordActivity(input: PublicActivity): DiscordActivity {
  const details = discordText(input.title);
  const channel = discordText(input.channel);
  const label = input.state === 'paused' ? PAUSED : input.kind === 'live' ? LIVE : undefined;
  const state = label && channel ? discordText(`${label} · ${channel}`) : (label ?? channel);
  const url = input.videoId && input.link ? videoUrl(input.kind, input.videoId) : undefined;
  const activity: DiscordActivity = { type: input.kind === 'music' ? 2 : 3 };
  if (details) {
    activity.details = details;
    activity.status_display_type = 2;
    if (url) activity.details_url = url;
  }
  if (state) activity.state = state;
  if (input.state === 'playing' && input.timestamps) {
    // The local RPC command takes Unix seconds. Gateway activity events use milliseconds.
    activity.timestamps = { start: Math.floor(input.timestamps.start / 1000) };
    if (input.timestamps.end !== undefined) {
      activity.timestamps.end = Math.ceil(input.timestamps.end / 1000);
    }
  }

  if (url) activity.buttons = [{ label: media[input.kind].button, url }];
  if (input.videoId && input.thumbnail) {
    activity.assets = {
      large_image: `https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg`,
      large_text: media[input.kind].artwork,
    };
    if (url) activity.assets.large_url = url;
  }
  return activity;
}
