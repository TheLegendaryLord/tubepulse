export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS = {
  enabled: true,
  privacy: false,
  showTitle: true,
  showChannel: true,
  showThumbnail: true,
  showProgress: true,
  showLink: true,
  trackMusic: false,
  trackShorts: true,
  showPaused: true,
  pauseTimeoutMinutes: 5,
};

export type Settings = typeof DEFAULT_SETTINGS;

export function normalizeSettings(value: unknown): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  if (!value || typeof value !== 'object') return settings;

  const stored = value as Record<string, unknown>;
  for (const key of Object.keys(settings) as (keyof Settings)[]) {
    const next = stored[key];
    if (key === 'pauseTimeoutMinutes') {
      if (typeof next === 'number' && Number.isInteger(next) && next >= 1 && next <= 60) {
        settings[key] = next;
      }
    } else if (typeof next === 'boolean') {
      settings[key] = next;
    }
  }
  return settings;
}
