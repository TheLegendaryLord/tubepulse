import { describe, expect, it } from 'vitest';
import {
  mediaRoute,
  projectActivity,
  selectPlayback,
  stableActivity,
  TAB_LEASE_MS,
  updateTabPlayback,
  type Playback,
} from './playback';
import {
  classifyPlayback,
  cleanText,
  hasAd,
  readMetadata,
  type Player,
  type VideoState,
} from './player';
import { verifyPlaybackMessage } from './extension-message';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';

const videoId = 'aqz-KE-bpKQ';
const nextId = 'dQw4w9WgXcQ';
const now = 1_800_000_000_000;
const playback: Playback = {
  kind: 'video',
  videoId,
  title: 'Big Buck Bunny',
  channel: 'Blender',
  live: false,
  state: 'playing',
  currentTime: 20,
  duration: 120,
  rate: 1,
};

describe('playback detection', () => {
  it('extracts a canonical ID across a YouTube playlist transition', () => {
    expect(mediaRoute(`https://www.youtube.com/watch?v=${videoId}&list=abc&index=1&t=20s`)).toEqual({
      kind: 'video',
      videoId,
    });
    expect(mediaRoute(`https://www.youtube.com/watch?v=${nextId}&list=abc&index=2`)).toEqual({
      kind: 'video',
      videoId: nextId,
    });
  });

  it('accepts only supported playback routes on exact HTTPS origins', () => {
    expect(mediaRoute(`https://www.youtube.com/shorts/${videoId}?feature=share`)).toEqual({
      kind: 'short',
      videoId,
    });
    expect(mediaRoute(`https://music.youtube.com/watch?v=${videoId}`)).toEqual({
      kind: 'music',
      videoId,
    });
    for (const url of [
      'not a URL',
      `http://www.youtube.com/watch?v=${videoId}`,
      `https://www.youtube.com.evil.invalid/watch?v=${videoId}`,
      `https://www.youtube.com:1234/watch?v=${videoId}`,
      `https://www.youtube.com/results?search_query=${videoId}`,
      'https://www.youtube.com/watch?v=invalid',
      `https://music.youtube.com/shorts/${videoId}`,
    ]) {
      expect(mediaRoute(url)).toBeNull();
    }
  });

  it('rejects ads, autoplay-blocked and ended media', () => {
    const state: VideoState = {
      ended: false,
      played: true,
      paused: false,
      seeking: false,
      readyState: 4,
      moving: true,
    };
    expect(classifyPlayback(state)).toBe('playing');
    expect(
      hasAd({ player: { matches: (selector: string) => selector.includes('.ad-showing') } } as Player),
    ).toBe(true);
    expect(classifyPlayback({ ...state, played: false })).toBeNull();
    expect(classifyPlayback({ ...state, ended: true })).toBeNull();
  });

  it('recognizes pausing, seeking, stalled media and resuming', () => {
    const state: VideoState = {
      ended: false,
      played: true,
      paused: false,
      seeking: false,
      readyState: 4,
      moving: true,
    };
    expect(classifyPlayback({ ...state, paused: true })).toBe('paused');
    expect(classifyPlayback({ ...state, seeking: true })).toBe('buffering');
    expect(classifyPlayback({ ...state, readyState: 2 })).toBe('buffering');
    expect(classifyPlayback({ ...state, moving: false })).toBe('buffering');
    expect(classifyPlayback(state)).toBe('playing');
  });

  it('reads the channel text before a container that repeats it in its tooltip', () => {
    const candidate = {
      metadata: {
        querySelector: (selector: string) => ({
          textContent: selector.endsWith('#text') ? 'Blender' : 'Blender Blender',
        }),
      },
    } as Player;
    expect(readMetadata(candidate, 'video', { ...DEFAULT_SETTINGS, showTitle: false })).toEqual({
      title: undefined,
      channel: 'Blender',
    });
  });
});

describe('content message authorization', () => {
  const extensionId = 'test-extension';
  const sender: chrome.runtime.MessageSender = {
    id: extensionId,
    origin: 'https://www.youtube.com',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    documentId: 'tab-document',
    documentLifecycle: 'active',
    frameId: 0,
    tab: { id: 1 } as chrome.tabs.Tab,
  };

  it('accepts a playlist or suggestion transition within the same authenticated document', () => {
    const next = { ...playback, videoId: nextId };
    expect(verifyPlaybackMessage({ type: 'playback', playback: next }, sender, extensionId)).toEqual({
      tabId: 1,
      documentId: 'tab-document',
      playback: next,
    });
  });

  it('rejects another extension, frame, origin or inactive document', () => {
    for (const altered of [
      { id: 'different-extension' },
      { frameId: 1 },
      { origin: 'https://www.youtube.com.evil.invalid' },
      { url: 'https://evil.invalid' },
      { documentLifecycle: 'cached' },
    ] satisfies Partial<chrome.runtime.MessageSender>[]) {
      expect(
        verifyPlaybackMessage({ type: 'playback', playback }, { ...sender, ...altered }, extensionId),
      ).toBeUndefined();
    }
  });

  it('rejects malformed or origin-incompatible playback', () => {
    for (const fields of [
      { rate: -1 },
      { kind: 'music' },
      { videoId: 'invalid' },
      { duration: Infinity },
      { title: 'one\ntwo' },
      { unknown: true },
    ]) {
      expect(
        verifyPlaybackMessage(
          { type: 'playback', playback: { ...playback, ...fields } },
          sender,
          extensionId,
        ),
      ).toBeUndefined();
    }
  });
});

describe('tab playback selection', () => {
  const enabledSettings = { ...DEFAULT_SETTINGS, enabled: true };
  const started = updateTabPlayback(undefined, playback, 'doc-a', now);
  const second = updateTabPlayback(undefined, { ...playback, videoId: nextId }, 'doc-b', now + 1_000);
  const paused = updateTabPlayback(started, { ...playback, state: 'paused' }, 'doc-a', now + 2_000);

  it('prefers playing over paused and the focused tab among playing tabs', () => {
    expect(
      selectPlayback(
        new Map([
          [1, paused],
          [2, second],
        ]),
        1,
        enabledSettings,
        now + 3_000,
      )?.tabId,
    ).toBe(2);
    expect(
      selectPlayback(
        new Map([
          [1, started],
          [2, second],
        ]),
        1,
        enabledSettings,
        now + 3_000,
      )?.tabId,
    ).toBe(1);
    expect(
      selectPlayback(
        new Map([
          [1, started],
          [2, second],
        ]),
        3,
        enabledSettings,
        now + 3_000,
      )?.tabId,
    ).toBe(2);
  });

  it('does not promote a tab merely because its heartbeat arrived more recently', () => {
    const heartbeat = updateTabPlayback(started, { ...playback, currentTime: 26 }, 'doc-a', now + 6_000);
    expect(
      selectPlayback(
        new Map([
          [1, heartbeat],
          [2, second],
        ]),
        undefined,
        enabledSettings,
        now + 7_000,
      )?.tabId,
    ).toBe(2);
    const switched = updateTabPlayback(
      heartbeat,
      { ...playback, videoId: nextId },
      'doc-a',
      now + 8_000,
    );
    expect(
      selectPlayback(
        new Map([
          [1, switched],
          [2, second],
        ]),
        undefined,
        enabledSettings,
        now + 9_000,
      )?.tabId,
    ).toBe(1);
  });

  it('clears after a configured pause, disappearance, or missing heartbeat', () => {
    const later = now + 60_000;
    const stillPaused = updateTabPlayback(paused, paused.playback, paused.documentId, later);
    const tabs = new Map([[1, stillPaused]]);
    const settings = { ...enabledSettings, pauseTimeoutMinutes: 1 };
    expect(selectPlayback(tabs, 1, settings, later + 1_999)?.tabId).toBe(1);
    expect(selectPlayback(tabs, 1, settings, later + 2_000)).toBeUndefined();
    expect(selectPlayback(tabs, 1, { ...settings, showPaused: false }, later)).toBeUndefined();
    expect(selectPlayback(new Map([[1, started]]), 1, settings, now + TAB_LEASE_MS)).toBeUndefined();
    tabs.delete(1);
    expect(selectPlayback(tabs, 1, settings, later)).toBeUndefined();
  });

  it('honors master, Shorts, and Music controls', () => {
    const music = updateTabPlayback(undefined, { ...playback, kind: 'music' }, 'doc-b', now);
    const shorts = updateTabPlayback(undefined, { ...playback, kind: 'short' }, 'doc-c', now);
    const tabs = new Map([
      [2, music],
      [3, shorts],
    ]);
    expect(selectPlayback(tabs, 2, enabledSettings, now)?.tabId).toBe(3);
    expect(selectPlayback(tabs, 2, { ...enabledSettings, trackMusic: true }, now)?.tabId).toBe(2);
    expect(selectPlayback(tabs, 3, { ...enabledSettings, trackShorts: false }, now)).toBeUndefined();
    expect(selectPlayback(tabs, 3, normalizeSettings(undefined), now)).toBeUndefined();
  });
});

describe('public activity', () => {
  const tab = updateTabPlayback(undefined, playback, 'doc-a', now);

  it('keeps only generic state in privacy mode', () => {
    expect(projectActivity(tab, { ...DEFAULT_SETTINGS, privacy: true })).toEqual({
      kind: 'video',
      state: 'playing',
    });
  });

  it('enables channel, title, link, thumbnail and clock independently', () => {
    const privateFields = {
      ...DEFAULT_SETTINGS,
      showChannel: false,
      showTitle: false,
      showLink: false,
      showThumbnail: false,
      showProgress: false,
    };
    expect(projectActivity(tab, privateFields)).toEqual({ kind: 'video', state: 'playing' });
    expect(projectActivity(tab, { ...privateFields, showLink: true })).toEqual({
      kind: 'video',
      state: 'playing',
      videoId,
      link: true,
      thumbnail: false,
    });
    expect(projectActivity(tab, { ...privateFields, showThumbnail: true })).toEqual({
      kind: 'video',
      state: 'playing',
      videoId,
      link: false,
      thumbnail: true,
    });
  });

  it('projects wall-clock timestamps for rate changes and seeks, with no clock while paused or live', () => {
    const fast = updateTabPlayback(tab, { ...playback, rate: 2 }, 'doc-a', now);
    expect(projectActivity(fast, DEFAULT_SETTINGS).timestamps).toEqual({
      start: now - 10_000,
      end: now + 50_000,
    });
    const seeked = updateTabPlayback(fast, { ...playback, rate: 2, currentTime: 90 }, 'doc-a', now);
    expect(projectActivity(seeked, DEFAULT_SETTINGS).timestamps).toEqual({
      start: now - 45_000,
      end: now + 15_000,
    });
    const paused = updateTabPlayback(seeked, { ...playback, state: 'paused' }, 'doc-a', now);
    const live = updateTabPlayback(tab, { ...playback, live: true }, 'doc-a', now);
    expect(projectActivity(paused, DEFAULT_SETTINGS).timestamps).toBeUndefined();
    expect(projectActivity(live, DEFAULT_SETTINGS)).toMatchObject({ kind: 'live' });
    expect(projectActivity(live, DEFAULT_SETTINGS).timestamps).toBeUndefined();
  });

  it('keeps insignificant heartbeat drift from becoming a new Discord clock', () => {
    const prior = projectActivity(tab, DEFAULT_SETTINGS);
    const jitter = updateTabPlayback(tab, { ...playback, currentTime: 26 }, 'doc-a', now + 6_500);
    expect(stableActivity(projectActivity(jitter, DEFAULT_SETTINGS), prior)).toEqual(prior);
    const seek = updateTabPlayback(tab, { ...playback, currentTime: 42 }, 'doc-a', now + 6_500);
    expect(stableActivity(projectActivity(seek, DEFAULT_SETTINGS), prior).timestamps).not.toEqual(
      prior.timestamps,
    );
  });

  it('limits metadata, trims control characters, and repairs a split emoji at the limit', () => {
    expect(cleanText('One\n two\t three')).toBe('One two three');
    expect(cleanText(`${'a'.repeat(127)}🙂`)).toBe('a'.repeat(127));
    expect(cleanText(' \n ')).toBeUndefined();
    expect(normalizeSettings({ enabled: false, showTitle: 'yes', pauseTimeoutMinutes: -1 })).toEqual({
      ...DEFAULT_SETTINGS,
      enabled: false,
    });
  });
});
