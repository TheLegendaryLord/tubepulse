import {
  mediaRoute,
  REPORT_INTERVAL_MS,
  trackingAllowed,
  type MediaRoute,
  type Playback,
} from './playback';
import { classifyPlayback, findPlayer, hasAd, readMetadata } from './player';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from './settings';

let settings = { ...DEFAULT_SETTINGS, enabled: false };
let route: MediaRoute | null = null;
let boundMedia:
  { video: HTMLVideoElement; source: string; generation: number; position: number } | undefined;
let observedPlayer: Element | undefined;
let previousMedia: typeof boundMedia;
const generations = new WeakMap<HTMLVideoElement, number>();
let lastSample: Playback | null = null;
let lastSentAt = 0;
let lastSampledAt = 0;
let lastTime = -1;
let lastMovementAt = 0;
let heartbeat: number | undefined;
let scheduled = false;
let pageActive = true;
let knownSettings = false;
let contextInvalidated = false;

function publish(playback: Playback | null, force = false): void {
  if (contextInvalidated) return;
  const now = Date.now();
  const changed =
    playback?.state !== lastSample?.state ||
    playback?.title !== lastSample?.title ||
    playback?.channel !== lastSample?.channel ||
    playback?.videoId !== lastSample?.videoId ||
    playback?.kind !== lastSample?.kind ||
    playback?.rate !== lastSample?.rate ||
    playback?.duration !== lastSample?.duration ||
    playback?.live !== lastSample?.live;
  if (playback ? !force && !changed && now - lastSentAt < REPORT_INTERVAL_MS : !lastSample) return;

  lastSample = playback;
  lastSentAt = now;
  // Reloading an unpacked extension invalidates scripts in old tabs until they are refreshed.
  try {
    void chrome.runtime.sendMessage({ type: 'playback', playback }).catch((error: unknown) => {
      if (!chrome.runtime.id) detach();
      else console.debug('TubePulse could not deliver playback', error);
    });
  } catch (error) {
    if (!chrome.runtime.id) detach();
    else console.debug('TubePulse could not deliver playback', error);
  }
}

const observer = new MutationObserver(() => queueSample());

function observePlayer(player?: Element): void {
  if (observedPlayer === player) return;
  observer.disconnect();
  observedPlayer = player;
  if (player) observer.observe(player, { attributes: true, attributeFilter: ['class'] });
}

function stopHeartbeat(): void {
  window.clearInterval(heartbeat);
  heartbeat = undefined;
}

function detach(): void {
  contextInvalidated = true;
  stopHeartbeat();
  observePlayer();
}

function syncRoute(): void {
  const next = pageActive ? mediaRoute(location.href) : null;
  const activeRoute = next && trackingAllowed(next.kind, settings) ? next : null;
  if (activeRoute?.kind === route?.kind && activeRoute?.videoId === route?.videoId) return;

  if (boundMedia) previousMedia = boundMedia;
  if (!pageActive || !settings.enabled) previousMedia = undefined;
  route = activeRoute;
  boundMedia = undefined;
  lastTime = -1;
  lastMovementAt = 0;
  observePlayer();
  publish(null);
  stopHeartbeat();
  if (route) heartbeat = window.setInterval(() => queueSample(), REPORT_INTERVAL_MS);
}

function sample(force: boolean): void {
  if (contextInvalidated) return;
  lastSampledAt = Date.now();
  syncRoute();
  if (!route) return;
  const candidate = findPlayer(document, route);
  observePlayer(candidate?.player);
  if (!candidate || hasAd(candidate)) {
    publish(null);
    return;
  }

  const video = candidate.video;
  const generation = generations.get(video) ?? 0;
  if (
    route.kind !== 'video' &&
    previousMedia &&
    video === previousMedia.video &&
    generation === previousMedia.generation &&
    video.currentSrc === previousMedia.source &&
    video.currentTime >= previousMedia.position - 0.5
  ) {
    // Shorts and Music can change the URL before switching a recycled player's media.
    // On watch pages the visible wrapper's exact video-id already anchors the player.
    return;
  }
  previousMedia = undefined;
  const now = Date.now();
  if (boundMedia?.video !== video || Math.abs(lastTime - video.currentTime) >= 0.025) {
    lastMovementAt = now;
    lastTime = video.currentTime;
  }
  boundMedia = { video, source: video.currentSrc, generation, position: video.currentTime };
  const state = classifyPlayback({
    ended: video.ended || Boolean(video.error),
    played: video.played.length > 0,
    paused: video.paused,
    seeking: video.seeking,
    readyState: video.readyState,
    moving: now - lastMovementAt < REPORT_INTERVAL_MS * 2,
  });
  if (
    !state ||
    !Number.isFinite(video.currentTime) ||
    video.currentTime < 0 ||
    video.currentTime > 604_800 ||
    video.playbackRate < 0.0625 ||
    video.playbackRate > 16 ||
    !Number.isFinite(video.playbackRate)
  ) {
    publish(null);
    return;
  }

  const live = video.duration === Infinity || candidate.player.classList.contains('ytp-live');
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 604_800
      ? video.duration
      : null;
  publish(
    {
      ...route,
      ...readMetadata(candidate, route.kind, settings),
      state,
      currentTime: video.currentTime,
      duration,
      rate: video.playbackRate,
      live,
    },
    force,
  );
}

let forceReport = false;

function queueSample(force = false): void {
  forceReport ||= force;
  if (scheduled || contextInvalidated) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const shouldReport = forceReport;
    forceReport = false;
    sample(shouldReport);
  });
}

function updateSettings(value: unknown): void {
  knownSettings = true;
  settings = normalizeSettings(value);
  queueSample(true);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) updateSettings(changes[SETTINGS_KEY].newValue);
});
void chrome.storage.local
  .get(SETTINGS_KEY)
  .then((stored) => {
    if (!knownSettings) updateSettings(stored[SETTINGS_KEY]);
  })
  .catch((error: unknown) => console.warn('TubePulse could not read its settings', error));

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.tab ||
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'sample'
  )
    return;
  queueSample(true);
  respond(true);
});

for (const event of [
  'play',
  'playing',
  'pause',
  'waiting',
  'seeking',
  'seeked',
  'ratechange',
  'ended',
  'loadstart',
  'loadedmetadata',
  'durationchange',
  'emptied',
  'error',
  'timeupdate',
]) {
  document.addEventListener(
    event,
    (message) => {
      if (!(message.target instanceof HTMLVideoElement)) return;
      if (event === 'loadstart' || event === 'emptied') {
        generations.set(message.target, (generations.get(message.target) ?? 0) + 1);
      }
      if (event !== 'timeupdate' || Date.now() - lastSampledAt >= 1_000) {
        queueSample(event === 'seeked' || event === 'ratechange');
      }
    },
    true,
  );
}

for (const event of ['yt-navigate-finish', 'yt-page-data-updated', 'visibilitychange']) {
  document.addEventListener(event, () => queueSample());
}
window.navigation?.addEventListener('currententrychange', () => queueSample());
window.addEventListener('popstate', () => queueSample());
window.addEventListener('pageshow', () => {
  pageActive = true;
  queueSample();
});
window.addEventListener('pagehide', () => {
  pageActive = false;
  syncRoute();
});
