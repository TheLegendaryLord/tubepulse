import {
  NATIVE_HOST,
  nativeStatusSchema,
  PROTOCOL_VERSION,
  type NativeCommand,
  type PublicActivity,
} from '@tubepulse/shared';
import {
  projectActivity,
  selectPlayback,
  stableActivity,
  TAB_LEASE_MS,
  trackingAllowed,
  updateTabPlayback,
  type TabPlayback,
} from './playback';
import { POPUP_PORT, type PopupState } from './popup-state';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from './settings';
import { verifyPlaybackMessage } from './extension-message';

const INITIAL_RETRY_MS = 1_000;
const NATIVE_LEASE_RENEWAL_MS = 10_000;
const PROBE_AFTER_MS = 16_000;

const tabs = new Map<number, TabPlayback>();
const probedAt = new Map<number, number>();
const popups = new Set<chrome.runtime.Port>();
let settings = { ...DEFAULT_SETTINGS, enabled: false };
let settingsLoaded = false;
let activeTab: number | undefined;
let focusRevision = 0;
let tabTimer: ReturnType<typeof setTimeout> | undefined;
let activity: PublicActivity | null = null;
let activitySource: string | undefined;

let native: chrome.runtime.Port | undefined;
let retryDelay = INITIAL_RETRY_MS;
let retryAfter = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
let companion: PopupState['companion'] = 'idle';
let discord: PopupState['discord'] = 'disabled';
let published = false;
let detail = '';
let lastCommand = '';
let lastCommandAt = 0;
let lastPopupState = '';

function popupState(): PopupState {
  return {
    youtubeDetected: settings.enabled && tabs.size > 0,
    companion: settingsLoaded && !settings.enabled ? 'off' : companion,
    discord: settings.enabled ? discord : 'disabled',
    published: settings.enabled && published,
    detail: settings.enabled ? detail : '',
    activity,
  };
}

function publishPopup(): void {
  const state = popupState();
  const serialized = JSON.stringify(state);
  if (lastPopupState === serialized) return;
  lastPopupState = serialized;
  for (const port of popups) {
    try {
      port.postMessage(state);
    } catch {
      popups.delete(port);
    }
  }
}

function wanted(): boolean {
  return settings.enabled && (activity !== null || popups.size > 0 || native !== undefined);
}

function disconnectNative(): void {
  clearTimeout(retryTimer);
  clearTimeout(handshakeTimer);
  clearTimeout(shutdownTimer);
  retryTimer = undefined;
  shutdownTimer = undefined;
  const port = native;
  native = undefined;
  port?.disconnect();
  retryAfter = 0;
  retryDelay = INITIAL_RETRY_MS;
  companion = 'idle';
  discord = 'disabled';
  published = false;
  detail = '';
}

function stopNative(now: number): void {
  if (!native) {
    disconnectNative();
    return;
  }
  if (shutdownTimer) return;
  shutdownTimer = setTimeout(disconnectNative, 3_000);
  sendActivity(null, now);
}

function nativeFailed(port: chrome.runtime.Port | undefined, reason: string): void {
  if (port !== native) return;
  native = undefined;
  clearTimeout(handshakeTimer);
  clearTimeout(shutdownTimer);
  shutdownTimer = undefined;
  port?.disconnect();
  companion = 'unavailable';
  discord = 'disabled';
  published = false;
  detail = reason;
  retryAfter = Date.now() + retryDelay;
  retryDelay = Math.min(25_000, retryDelay * 2);
  sync();
}

function connectNative(now: number): void {
  if (native || !wanted()) return;
  if (now < retryAfter) {
    retryTimer ??= setTimeout(() => {
      retryTimer = undefined;
      sync();
    }, retryAfter - now);
    return;
  }
  clearTimeout(retryTimer);
  retryTimer = undefined;

  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (error) {
    console.debug('TubePulse could not open the Native Messaging port', error);
    nativeFailed(undefined, 'Could not open the companion. Check the Windows installation.');
    return;
  }

  native = port;
  companion = 'connecting';
  discord = 'connecting';
  detail = '';
  lastCommand = '';
  lastCommandAt = 0;
  handshakeTimer = setTimeout(() => {
    nativeFailed(port, 'The companion did not reply. Check that the installed versions match.');
  }, 8_000);
  port.onMessage.addListener((message: unknown) => {
    if (native !== port) return;
    const status = nativeStatusSchema.safeParse(message);
    if (!status.success) {
      nativeFailed(port, 'Incompatible companion response. Install matching versions.');
      return;
    }
    clearTimeout(handshakeTimer);
    retryDelay = INITIAL_RETRY_MS;
    retryAfter = 0;
    companion = 'ready';
    discord = status.data.discord;
    published = status.data.published === true;
    detail = status.data.detail ?? '';
    if (shutdownTimer && status.data.discord === 'ready' && status.data.published === false)
      disconnectNative();
    publishPopup();
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (native !== port) return;
    if (error) console.debug('TubePulse native port closed', error);
    const hint = error?.includes('forbidden')
      ? 'The extension ID is not enrolled. Run the Windows setup again.'
      : 'The companion is unavailable. Run the Windows setup and recheck.';
    nativeFailed(port, hint);
  });
}

function sendActivity(next: PublicActivity | null, now: number): void {
  const port = native;
  if (!port) return;
  const command: NativeCommand = { v: PROTOCOL_VERSION, type: 'activity', activity: next };
  const serialized = JSON.stringify(command);
  if (lastCommand === serialized && (!next || now - lastCommandAt < NATIVE_LEASE_RENEWAL_MS)) return;
  try {
    port.postMessage(command);
    lastCommand = serialized;
    lastCommandAt = now;
  } catch (error) {
    console.debug('TubePulse could not send an activity to the companion', error);
    nativeFailed(port, 'The connection to the companion was interrupted.');
  }
}

function removeTab(tabId: number): void {
  if (!tabs.delete(tabId)) return;
  probedAt.delete(tabId);
  sync();
}

function maintainTabLeases(now: number): void {
  clearTimeout(tabTimer);
  let nextCheck = Infinity;
  for (const [tabId, tab] of tabs) {
    const expiresAt = tab.receivedAt + TAB_LEASE_MS;
    if (now >= expiresAt) {
      tabs.delete(tabId);
      probedAt.delete(tabId);
      continue;
    }
    const probeAt = tab.receivedAt + PROBE_AFTER_MS;
    if (probedAt.get(tabId) !== tab.receivedAt) {
      if (now >= probeAt) {
        probedAt.set(tabId, tab.receivedAt);
        // Hidden Chrome tabs can throttle their own timers. A worker-initiated message refreshes the lease.
        void chrome.tabs
          .sendMessage(tabId, { type: 'sample' }, { documentId: tab.documentId })
          .catch((error: unknown) => {
            console.debug('TubePulse could not renew the tab lease', error);
          });
      } else {
        nextCheck = Math.min(nextCheck, probeAt);
      }
    }
    nextCheck = Math.min(nextCheck, expiresAt);
    if (tab.playback.state !== 'playing') {
      const pauseEndsAt = tab.stateSince + settings.pauseTimeoutMinutes * 60_000;
      if (pauseEndsAt > now) nextCheck = Math.min(nextCheck, pauseEndsAt);
    }
  }
  if (Number.isFinite(nextCheck)) tabTimer = setTimeout(sync, Math.max(1, nextCheck - now));
}

function sync(): void {
  const now = Date.now();
  maintainTabLeases(now);
  const chosen = selectPlayback(tabs, activeTab, settings, now);
  const source = chosen && `${chosen.tabId}/${chosen.tab.documentId}/${chosen.tab.playback.videoId}`;
  activity = chosen
    ? stableActivity(projectActivity(chosen.tab, settings), source === activitySource ? activity : null)
    : null;
  activitySource = source;

  if (settings.enabled) {
    clearTimeout(shutdownTimer);
    shutdownTimer = undefined;
    connectNative(now);
    sendActivity(activity, now);
  } else {
    stopNative(now);
  }
  publishPopup();
}

function refreshFocus(): void {
  const revision = ++focusRevision;
  void chrome.tabs
    .query({ active: true, lastFocusedWindow: true })
    .then(([tab]) => {
      if (focusRevision !== revision || activeTab === tab?.id) return;
      activeTab = tab?.id;
      sync();
    })
    .catch((error: unknown) => console.debug('TubePulse could not determine the active tab', error));
}

function applySettings(value: unknown): void {
  settingsLoaded = true;
  settings = normalizeSettings(value);
  for (const [tabId, tab] of tabs) {
    if (!trackingAllowed(tab.playback.kind, settings)) {
      tabs.delete(tabId);
      probedAt.delete(tabId);
    } else {
      if (settings.privacy || !settings.showTitle) delete tab.playback.title;
      if (settings.privacy || !settings.showChannel) delete tab.playback.channel;
    }
  }
  sync();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
});

const initialization = chrome.storage.local
  .get(SETTINGS_KEY)
  .then((stored) => {
    if (!settingsLoaded) applySettings(stored[SETTINGS_KEY]);
  })
  .catch((error: unknown) => console.warn('TubePulse could not read its settings', error));

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  const verified = verifyPlaybackMessage(message, sender, chrome.runtime.id);
  if (!verified) return false;
  const { tabId, documentId, playback: next } = verified;

  void initialization.then(() => {
    const previous = tabs.get(tabId);
    if (!next || !trackingAllowed(next.kind, settings)) {
      if (previous?.documentId === documentId) removeTab(tabId);
    } else {
      if (settings.privacy || !settings.showTitle) delete next.title;
      if (settings.privacy || !settings.showChannel) delete next.channel;
      tabs.set(tabId, updateTabPlayback(previous, next, documentId, Date.now()));
      sync();
    }
    respond(true);
  });
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== POPUP_PORT ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender.url !== chrome.runtime.getURL('popup.html')
  ) {
    port.disconnect();
    return;
  }
  popups.add(port);
  port.onDisconnect.addListener(() => {
    popups.delete(port);
    if (!wanted()) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  });
  port.onMessage.addListener((message: unknown) => {
    if (message !== 'retry') return;
    retryAfter = 0;
    sync();
  });
  port.postMessage(popupState());
  void initialization.then(sync);
});

chrome.tabs.onActivated.addListener(refreshFocus);
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshFocus();
});
chrome.tabs.onRemoved.addListener(removeTab);
chrome.tabs.onReplaced.addListener((_added, removed) => removeTab(removed));
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.discarded || changes.status === 'loading') removeTab(tabId);
});
refreshFocus();
