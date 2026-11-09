import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const zip = resolve(
  process.argv[2] ?? join(repoRoot, 'artifacts', `TubePulse-${version}-windows-x64.zip`),
);
const hash = createHash('sha256').update(readFileSync(zip)).digest('hex');
assert.equal(readFileSync(`${zip}.sha256`, 'utf8').trim(), `${hash}  ${basename(zip)}`);

const sandbox = mkdtempSync(join(tmpdir(), 'TubePulse package smoke '));
try {
  const unpacked = join(sandbox, 'unpacked');
  const expand = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:TUBEPULSE_TEST_ZIP, $env:TUBEPULSE_TEST_UNPACKED)",
    ],
    {
      env: { ...process.env, TUBEPULSE_TEST_ZIP: zip, TUBEPULSE_TEST_UNPACKED: unpacked },
      windowsHide: true,
      timeout: 90_000,
    },
  );
  assert.ifError(expand.error);
  assert.equal(expand.status, 0, expand.stderr.toString());

  const manifest = JSON.parse(
    readFileSync(join(unpacked, 'payload', 'extension', 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, version);

  const extensionId = 'a'.repeat(32);
  const appData = join(sandbox, 'Local AppData');
  const configDir = join(appData, 'TubePulse');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({ extensionId, discordApplicationId: '123456789012345678' }),
  );

  // A null activity exercises the host's stdio framing without publishing anything.
  const message = Buffer.from(JSON.stringify({ v: 1, type: 'activity', activity: null }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(message.length);
  const executable = join(unpacked, 'payload', 'TubePulse.exe');
  const options = {
    input: Buffer.concat([length, message]),
    env: { ...process.env, LOCALAPPDATA: appData, NODE_OPTIONS: '--require=unexpected-module' },
    windowsHide: true,
    timeout: 10_000,
  };
  const accepted = spawnSync(
    executable,
    [`chrome-extension://${extensionId}/`, '--parent-window=0'],
    options,
  );
  assert.ifError(accepted.error);
  assert.equal(accepted.status, 0, accepted.stderr.toString());
  const statusLength = accepted.stdout.readUInt32LE();
  assert.deepEqual(JSON.parse(accepted.stdout.subarray(4, 4 + statusLength).toString()), {
    v: 1,
    type: 'status',
    discord: 'connecting',
  });

  const rejected = spawnSync(executable, [`chrome-extension://${'b'.repeat(32)}/`], options);
  assert.ifError(rejected.error);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout.length, 0);
  assert.match(rejected.stderr.toString(), /origin does not match/i);
  process.stdout.write(
    'Windows ZIP, checksum, native messaging framing and origin validation passed.\n',
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
