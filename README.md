# usage-glance

Local web dashboard showing remaining Claude and Codex usage windows.

## Prerequisites

- Node 24
- npm

## Setup

```bash
npm install
```

## Development

```bash
npm run dev
```

Starts the server with hot-reload via `tsx watch`. The server binds to `127.0.0.1:3000` by default (local-only). Override the port with the `PORT` environment variable:

```bash
PORT=8080 npm run dev
```

## Local verification gates

```bash
npm test          # run Vitest unit tests
npm run lint      # ESLint
npm run typecheck # tsc --noEmit (type-check without emitting)
npm run build     # bundle client and compile server
```

## One-shot production start

```bash
npm run build
npm start
```

Runs the compiled server from `dist/`. Binds to `127.0.0.1:3000` by default; override with `PORT`.

Confirm it is healthy:

```bash
curl -fsS http://127.0.0.1:3000/healthz
# {"status":"ok","uptime":0.123}
```

## Launchd-managed local service

> **Nathan approval required.** The commands `service:install`, `service:start`, `service:restart`, and `service:uninstall` mutate Nathan's Mac Mini LaunchAgents. Agents must **not** run these commands without explicit Nathan approval and action. `service:status` and `service:verify` are observational but depend on local service state and should still be run with awareness that they reflect Nathan's machine.

The service is registered as a LaunchAgent on Nathan's Mac Mini:

| Item | Value |
|------|-------|
| Label | `com.nwynmaok.usage-glance` |
| Plist | `~/Library/LaunchAgents/com.nwynmaok.usage-glance.plist` |
| stdout log | `~/Library/Logs/usage-glance/stdout.log` |
| stderr log | `~/Library/Logs/usage-glance/stderr.log` |
| Health URL | `http://127.0.0.1:3000/healthz` |

### Service commands

| Command | Effect | Mutates LaunchAgents? |
|---------|--------|-----------------------|
| `npm run service:install` | Generates plist, writes it to `~/Library/LaunchAgents/`, and loads it with `launchctl` | **Yes** |
| `npm run service:start` | Loads/starts the service via `launchctl` | **Yes** |
| `npm run service:restart` | Unloads then reloads the service | **Yes** |
| `npm run service:status` | Prints current `launchctl` state | No |
| `npm run service:verify` | Checks service is running and health endpoint responds | No |
| `npm run service:uninstall` | Unloads the service and removes the plist | **Yes** |

Typical first-install workflow (Nathan only):

```bash
npm run build
npm run service:install
npm run service:verify
```

After a code change (Nathan only):

```bash
npm run build
npm run service:restart
npm run service:verify
```

## API

### `GET /healthz`

Returns server health:

```json
{ "status": "ok", "uptime": 12.345 }
```

- `status` — always `"ok"` when the server is running
- `uptime` — seconds since process start (`process.uptime()`)

## Troubleshooting

1. **Build artifacts missing** — Run `npm run build` and confirm `dist/server/index.js` exists before starting or installing the service.

2. **Service not running** — Run `npm run service:status` to check the `launchctl` state. A `LastExitStatus` other than `0` indicates a crash.

3. **Inspect stderr** — Check `~/Library/Logs/usage-glance/stderr.log` for startup errors or uncaught exceptions.

4. **Port conflict** — If `http://127.0.0.1:3000/healthz` is unreachable, check for another process using that port:
   ```bash
   lsof -iTCP:3000 -sTCP:LISTEN
   ```

5. **Wrong Node/npm path** — The generated plist hard-codes the npm/node path discovered at install time. If the service fails after a Node version change, run `npm run service:uninstall` then `npm run service:install` again to regenerate the plist with the current Node 24-capable path.

## What is not implemented

Usage collectors, provider log parsing, polling, usage cards, real dashboard data, and Tailscale configuration are intentionally out of scope for the current iteration. They will be added in future iterations. When provider percentages are introduced, they will be approximations derived from local data and will not reflect provider-authoritative figures.
