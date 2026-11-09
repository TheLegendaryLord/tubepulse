import { loadConfig } from './config.js';
import { serveChrome } from './host.js';
import { jsonPacket } from './packet.js';
import { PresenceSession } from './session.js';

function report(message: string): void {
  process.stderr.write(`TubePulse: ${message}\n`);
}

try {
  // Chrome supplies the caller's origin as its first host argument.
  const config = loadConfig(process.env.LOCALAPPDATA, process.argv[2]);
  const session = new PresenceSession(config.discordApplicationId, (status) => {
    process.stdout.write(jsonPacket(status));
  });
  const stop = serveChrome(process.stdin, process.stdout, session, report);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {
  report(error instanceof Error ? error.message : 'Could not start the native host.');
  process.exitCode = 1;
}
