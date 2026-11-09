import type { PublicActivity } from '@tubepulse/shared';
import type { Settings } from './settings';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const REPORT_INTERVAL_MS = 6_000;
export const TAB_LEASE_MS = 28_000;

export type MediaKind = 'video' | 'short' | 'music';
export type PlaybackState = 'playing' | 'paused' | 'buffering';

export interface MediaRoute {
  kind: MediaKind;
  videoId: string;
}

export interface Playback extends MediaRoute {
  title?: string | undefined;
  channel?: string | undefined;
  live: boolean;
  state: PlaybackState;
  currentTime: number;
  duration: number | null;
  rate: number;
}

export interface TabPlayback {
  playback: Playback;
  receivedAt: number;
  lastStartedAt: number;
  stateSince: number;
  documentId: string;
}

export function mediaRoute(url: string): MediaRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isVideo = parsed.origin === 'https://www.youtube.com';
  const isMusic = parsed.origin === 'https://music.youtube.com';
  if (!isVideo && !isMusic) return null;

  if (parsed.pathname === '/watch') {
    const videoId = parsed.searchParams.get('v');
    if (videoId && VIDEO_ID.test(videoId)) return { kind: isMusic ? 'music' : 'video', videoId };
  }
  if (isVideo && parsed.pathname.startsWith('/shorts/')) {
    const videoId = parsed.pathname.slice('/shorts/'.length).replace(/\/$/, '');
    if (VIDEO_ID.test(videoId)) return { kind: 'short', videoId };
  }
  return null;
}

export function trackingAllowed(kind: MediaKind, settings: Settings): boolean {
  return (
    settings.enabled &&
    (kind !== 'music' || settings.trackMusic) &&
    (kind !== 'short' || settings.trackShorts)
  );
}

export function updateTabPlayback(
  previous: TabPlayback | undefined,
  playback: Playback,
  documentId: string,
  now: number,
): TabPlayback {
  const sameVideo =
    previous?.documentId === documentId &&
    previous.playback.videoId === playback.videoId &&
    previous.playback.kind === playback.kind;
  const sameMotion =
    sameVideo && (previous.playback.state === 'playing') === (playback.state === 'playing');
  return {
    playback,
    documentId,
    receivedAt: now,
    stateSince: sameMotion ? previous.stateSince : now,
    lastStartedAt:
      playback.state === 'playing' && !sameMotion ? now : sameVideo ? previous.lastStartedAt : 0,
  };
}

export function selectPlayback(
  tabs: ReadonlyMap<number, TabPlayback>,
  activeTab: number | undefined,
  settings: Settings,
  now: number,
): { tabId: number; tab: TabPlayback } | undefined {
  let selected: { tabId: number; tab: TabPlayback } | undefined;
  let bestPriority = -1;
  for (const [tabId, tab] of tabs) {
    if (now - tab.receivedAt >= TAB_LEASE_MS || !trackingAllowed(tab.playback.kind, settings)) continue;
    const playing = tab.playback.state === 'playing';
    if (
      !playing &&
      (!settings.showPaused || now - tab.stateSince >= settings.pauseTimeoutMinutes * 60_000)
    ) {
      continue;
    }
    const priority = (playing ? 2 : 0) + (activeTab === tabId ? 1 : 0);
    if (
      priority > bestPriority ||
      (priority === bestPriority && tab.lastStartedAt > (selected?.tab.lastStartedAt ?? -1))
    ) {
      selected = { tabId, tab };
      bestPriority = priority;
    }
  }
  return selected;
}

export function projectActivity(tab: TabPlayback, settings: Settings): PublicActivity {
  const playback = tab.playback;
  const state = playback.state === 'playing' ? 'playing' : 'paused';
  if (settings.privacy) return { kind: 'video', state };

  const activity: PublicActivity = { kind: playback.live ? 'live' : playback.kind, state };
  if (settings.showTitle && playback.title) activity.title = playback.title;
  if (settings.showChannel && playback.channel) activity.channel = playback.channel;
  if (settings.showLink || settings.showThumbnail) {
    activity.videoId = playback.videoId;
    activity.link = settings.showLink;
    activity.thumbnail = settings.showThumbnail;
  }
  const { currentTime, duration, rate } = playback;
  if (
    settings.showProgress &&
    state === 'playing' &&
    !playback.live &&
    duration &&
    currentTime < duration
  ) {
    const start = Math.round(tab.receivedAt - (currentTime / rate) * 1_000);
    const end = Math.round(start + (duration / rate) * 1_000);
    if (start > 0 && end > start) activity.timestamps = { start, end };
  }
  return activity;
}

export function stableActivity(
  activity: PublicActivity,
  previous: PublicActivity | null,
): PublicActivity {
  const currentTime = activity.timestamps;
  const previousTime = previous?.timestamps;
  if (
    currentTime &&
    previousTime &&
    Math.abs(currentTime.start - previousTime.start) <= 1_500 &&
    Math.abs((currentTime.end ?? 0) - (previousTime.end ?? 0)) <= 1_500
  ) {
    return { ...activity, timestamps: previousTime };
  }
  return activity;
}
