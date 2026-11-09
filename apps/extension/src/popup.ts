import { POPUP_PORT, type PopupState } from './popup-state';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY, type Settings } from './settings';
import './popup.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`TubePulse popup is missing ${id}`);
  return found as T;
}

const title = element('activity-title');
const subtitle = element('activity-channel');
const progress = element<HTMLProgressElement>('progress-bar');
const previewProgress = element('preview-progress');
const elapsed = element('time-elapsed');
const total = element('time-total');
const chip = element('state-chip');
const youtube = element('youtube');
const companion = element('companion');
const discord = element('discord');
const detail = element('connection-detail');
const settingsError = element('settings-error');
const extensionId = element<HTMLInputElement>('extension-id');
const retry = element<HTMLButtonElement>('retry');
const setupNote = element('setup-note');
const controls = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
let settings = DEFAULT_SETTINGS;
let settingsLoaded = false;
let worker: chrome.runtime.Port | undefined;
let activeClock: { start: number; end?: number } | undefined;
let current: PopupState = {
  youtubeDetected: false,
  companion: 'idle',
  discord: 'disabled',
  published: false,
  detail: '',
  activity: null,
};

function showStatus(output: HTMLElement, text: string, tone: 'neutral' | 'ok' | 'warn'): void {
  output.textContent = text;
  output.dataset.tone = tone;
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  const remaining = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(mins % 60).padStart(2, '0')}:${remaining}` : `${mins}:${remaining}`;
}

function renderClock(): void {
  const start = activeClock?.start;
  const end = activeClock?.end;
  previewProgress.hidden = !start || !end;
  if (!start || !end) return;
  const duration = end - start;
  const passed = Math.min(duration, Math.max(0, Date.now() - start));
  progress.value = passed / duration;
  elapsed.textContent = formatTime(passed);
  total.textContent = formatTime(duration);
}

function render(): void {
  const { activity, published } = current;
  const enabled = settings.enabled;
  const privateView = settings.privacy;
  const playing = activity?.state === 'playing';
  const status = !enabled ? 'Off' : playing ? 'Playing' : activity ? 'Paused' : 'Idle';
  showStatus(chip, status, playing && enabled ? 'ok' : 'neutral');
  showStatus(
    youtube,
    enabled && current.youtubeDetected ? 'Detected' : enabled ? 'Waiting' : 'Off',
    enabled && current.youtubeDetected ? 'ok' : 'neutral',
  );

  const companionName = !enabled
    ? 'Off'
    : {
        idle: 'Checking',
        connecting: 'Connecting',
        ready: 'Connected',
        unavailable: 'Unavailable',
        off: 'Off',
      }[current.companion];
  showStatus(
    companion,
    companionName,
    !enabled
      ? 'neutral'
      : current.companion === 'ready'
        ? 'ok'
        : current.companion === 'unavailable'
          ? 'warn'
          : 'neutral',
  );

  const discordName = !enabled
    ? 'Off'
    : {
        disabled: current.companion === 'ready' ? 'Setup needed' : 'Waiting',
        connecting: 'Connecting',
        ready: published ? 'Activity shared' : 'Connected',
        error: 'Unavailable',
      }[current.discord];
  showStatus(
    discord,
    discordName,
    !enabled
      ? 'neutral'
      : current.discord === 'ready'
        ? 'ok'
        : current.discord === 'error'
          ? 'warn'
          : 'neutral',
  );
  detail.hidden = !current.detail || !enabled;
  detail.textContent = enabled ? current.detail : '';

  if (!enabled || !activity) {
    title.textContent = enabled ? 'Waiting for playback' : 'TubePulse is off';
    subtitle.textContent = enabled
      ? 'Play a video on YouTube to begin.'
      : 'Choose what to share below. When you turn TubePulse on, Discord may show those playback details to others.';
  } else if (privateView) {
    title.textContent = 'Watching YouTube';
    subtitle.textContent = 'Privacy mode is on.';
  } else {
    const generic = {
      video: 'YouTube video',
      short: 'YouTube Short',
      music: 'YouTube Music',
      live: 'YouTube livestream',
    }[activity.kind];
    title.textContent = (settings.showTitle && activity.title) || generic;
    subtitle.textContent = (settings.showChannel && activity.channel) || '';
  }
  activeClock = enabled && !privateView && settings.showProgress ? activity?.timestamps : undefined;
  renderClock();
}

function renderSettings(): void {
  for (const key of controls) {
    if (key === 'pauseTimeoutMinutes') {
      const timeout = element<HTMLSelectElement>(key);
      const value = String(settings.pauseTimeoutMinutes);
      if (!Array.from(timeout.options).some((option) => option.value === value)) {
        timeout.add(new Option(`${value} min`, value));
      }
      timeout.value = value;
      timeout.disabled = !settings.showPaused;
    } else {
      const control = element<HTMLInputElement>(key);
      control.checked = settings[key];
      control.disabled = false;
    }
  }
  element<HTMLFieldSetElement>('activity-settings').disabled = settings.privacy;
  element<HTMLFieldSetElement>('playback-settings').disabled = false;
  retry.disabled = !settings.enabled;
  render();
}

function applySettings(value: unknown): void {
  settingsLoaded = true;
  settings = normalizeSettings(value);
  renderSettings();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SETTINGS_KEY] && !writesPending)
    applySettings(changes[SETTINGS_KEY].newValue);
});
void chrome.storage.local
  .get(SETTINGS_KEY)
  .then((stored) => {
    if (!settingsLoaded) applySettings(stored[SETTINGS_KEY]);
  })
  .catch((error: unknown) => {
    settingsError.hidden = false;
    settingsError.textContent = 'Settings are unavailable. Close and reopen this popup.';
    console.warn('TubePulse could not read its settings', error);
  });

let pendingWrite = Promise.resolve();
let writesPending = 0;
for (const key of controls) {
  const control = element<HTMLInputElement | HTMLSelectElement>(key);
  control.addEventListener('change', () => {
    const value = control instanceof HTMLInputElement ? control.checked : Number(control.value);
    settings = normalizeSettings({ ...settings, [key]: value });
    renderSettings();
    writesPending++;
    pendingWrite = pendingWrite
      .then(async () => {
        const stored = await chrome.storage.local.get(SETTINGS_KEY);
        const nextSettings = normalizeSettings({
          ...normalizeSettings(stored[SETTINGS_KEY]),
          [key]: value,
        });
        await chrome.storage.local.set({ [SETTINGS_KEY]: nextSettings });
        settingsError.hidden = true;
        if (writesPending === 1) applySettings(nextSettings);
      })
      .catch((error: unknown) => {
        settingsError.hidden = false;
        settingsError.textContent = 'Your settings could not be saved.';
        console.warn('TubePulse could not write its settings', error);
        return chrome.storage.local
          .get(SETTINGS_KEY)
          .then((stored) => {
            if (writesPending === 1) applySettings(stored[SETTINGS_KEY]);
          })
          .catch((readError: unknown) =>
            console.warn('TubePulse could not reload its settings', readError),
          );
      })
      .finally(() => {
        writesPending--;
      });
  });
}

function connectWorker(): void {
  const port = chrome.runtime.connect({ name: POPUP_PORT });
  worker = port;
  port.onMessage.addListener((message: PopupState) => {
    current = message;
    render();
  });
  port.onDisconnect.addListener(() => {
    if (worker !== port) return;
    const error = chrome.runtime.lastError?.message;
    if (error) console.debug('TubePulse popup connection closed', error);
    worker = undefined;
    current = {
      youtubeDetected: false,
      companion: 'unavailable',
      discord: 'disabled',
      published: false,
      activity: null,
      detail: 'Could not contact the extension worker. Check the connection or reopen this popup.',
    };
    render();
  });
}

extensionId.value = chrome.runtime.id;
element('version').textContent = `v${chrome.runtime.getManifest().version}`;
element('copy-id').addEventListener('click', () => {
  void navigator.clipboard
    .writeText(extensionId.value)
    .then(() => {
      setupNote.textContent = 'Extension ID copied.';
    })
    .catch(() => {
      extensionId.select();
      setupNote.textContent = 'Copy the selected extension ID.';
    });
});
retry.addEventListener('click', () => {
  if (worker) worker.postMessage('retry');
  else connectWorker();
});
window.setInterval(renderClock, 500);
connectWorker();
