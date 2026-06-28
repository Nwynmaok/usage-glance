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

## Usage snapshot API

### `GET /api/usage`

Returns an array of `ProviderUsageSnapshot` values for Codex and Claude:

```json
[
  {
    "provider": "codex",
    "state": "ok",
    "source": {
      "kind": "codex-cli-status-text",
      "label": "Live local CLI-derived",
      "confidence": "user-visible-cli",
      "caveat": "Not provider-authoritative API data"
    },
    "windows": [
      { "name": "5h", "percentRemaining": 82, "resetLabel": "15:18" },
      { "name": "weekly", "percentRemaining": 36 }
    ],
    "updatedAt": "2026-06-27T17:45:00.000Z",
    "stale": false
  },
  {
    "provider": "claude",
    "state": "manual",
    "source": { "kind": "manual-dashboard-only", "label": "Manual/dashboard-only", ... },
    "windows": [],
    "stale": false,
    "message": "Check usage manually: Claude Code `/usage`, or Claude.ai Settings > Usage."
  }
]
```

Responses are cached for 60 seconds; the local snapshot file is never read more often than that.

## Codex local snapshot configuration

Codex usage is read from a local JSON snapshot file. The default path is `data/provider-usage/codex.json` relative to the working directory. Override with the `CODEX_SNAPSHOT_PATH` environment variable.

Snapshot format:

```json
{
  "provider": "codex",
  "source": "codex-cli-status-text",
  "updatedAt": "2026-06-27T17:45:00.000Z",
  "windows": [
    { "name": "5h", "percentRemaining": 82, "resetLabel": "15:18" },
    { "name": "weekly", "percentRemaining": 36 }
  ],
  "raw": "optional /status text excerpt"
}
```

Write this file manually or via a script that captures `codex /status` output. The dashboard will show a stale indicator if the file is more than 5 minutes old.

## What is not implemented

- **Fully automated provider-authoritative usage collection** — values shown are derived from local snapshots and are approximations, not real-time provider figures.
- **Claude automated remaining percentages** — Claude usage requires manual checking. Use Claude Code `/usage` or Claude.ai Settings > Usage. Automated collection from local JSONL/session logs is not implemented in this version.
- **Web scraping, external API calls, or data egress** — no usage data leaves the local machine.
- **Tailscale configuration** — reach the dashboard remotely via your existing Tailscale setup; no additional configuration is provided here.
