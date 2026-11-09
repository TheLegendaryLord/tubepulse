# Contributing

TubePulse uses npm workspaces. Keep changes in the owning package.

| Path              | Responsibility                                             |
| ----------------- | ---------------------------------------------------------- |
| `apps/extension`  | Chrome content scripts, service worker, popup and settings |
| `apps/companion`  | Native host, Discord IPC and activity lifecycle            |
| `packages/shared` | Versioned messages and validation                          |
| `scripts`         | Windows packaging and per-user installation                |

Run `npm ci` with Node.js 24 LTS. Before submitting a change, run `npm run format`, `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`. For a Windows distribution change, also run `npm run package:windows` and follow the relevant [validation steps](docs/validation.md).

When reporting a problem, include Chrome, Discord and Windows versions and the steps to reproduce. Use a public test video when useful. Redact private video data, file paths containing user names, Discord account information and credentials from anything you share.
