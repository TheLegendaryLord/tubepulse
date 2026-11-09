import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HostConfig {
  extensionId: string;
  discordApplicationId: string;
}

const extensionIdPattern = /^[a-p]{32}$/;
const applicationIdPattern = /^[1-9][0-9]{16,19}$/;
const maxSnowflake = 18_446_744_073_709_551_615n;

export function validateConfig(value: unknown, origin: string | undefined): HostConfig {
  if (typeof value !== 'object' || !value || Array.isArray(value)) {
    throw new Error('Invalid TubePulse configuration. Rerun the installer.');
  }

  const { extensionId, discordApplicationId } = value as Record<string, unknown>;
  if (
    typeof extensionId !== 'string' ||
    !extensionIdPattern.test(extensionId) ||
    origin !== `chrome-extension://${extensionId}/`
  ) {
    throw new Error('Chrome origin does not match the configured TubePulse extension.');
  }

  if (
    typeof discordApplicationId !== 'string' ||
    !applicationIdPattern.test(discordApplicationId) ||
    BigInt(discordApplicationId) > maxSnowflake
  ) {
    throw new Error('Invalid Discord Application ID. Rerun the TubePulse installer.');
  }

  return { extensionId, discordApplicationId };
}

export function loadConfig(localAppData: string | undefined, origin: string | undefined): HostConfig {
  if (!localAppData) throw new Error('LOCALAPPDATA is unavailable.');
  let value: unknown;
  try {
    const raw = readFileSync(join(localAppData, 'TubePulse', 'config.json'), 'utf8');
    value = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new Error('Could not read TubePulse configuration. Rerun the installer.');
  }
  return validateConfig(value, origin);
}
