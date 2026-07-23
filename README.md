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

#### Freshness semantics and card-visible behavior

Each snapshot carries its own freshness budget. A snapshot is **stale** when
`now - generatedAt > staleAfterSeconds` (the generated-snapshot budget is 300 s / 5 min
for API and Codex CLI sources, 900 s / 15 min for the Claude statusLine fallback). Freshness
is per-provider and computed at read time, independent of `/healthz` — so `/healthz` can be
`ok` while `/api/usage` reports one or both providers stale.

When a snapshot is stale, `GET /api/usage` returns it with:

- `stale: true`
- `state: "unknown"` (last-known percentages are still returned in `windows`, but the traffic-light
  state is suppressed because the numbers may no longer be accurate)
- a sanitized, actionable `message`. Any existing sanitized guidance (e.g. the Claude
  `MANUAL_REFRESH_REQUIRED` instruction) is preserved; otherwise a generic
  `"Snapshot is older than N min. Click Refresh to update, or check the provider directly."`
  is attached. This message is derived only from the snapshot's own metadata — it never contains
  raw provider output, error text, or credentials.

The card reflects this directly:

- A **stale** badge appears next to the provider name and the update time is suffixed `(stale)`.
- Last-known window numbers stay visible, and the actionable `message` is shown **alongside** them
  (not only when there are no windows) so a stale card is never silent, unexplained old numbers.
- Clicking **Refresh** runs the provider's generation script. On success a snapshot with a current
  `generatedAt` is written, so the next `GET /api/usage` clears `stale` and drops the generic
  guidance (stale-to-refreshed). If the refresh cannot obtain fresh data (e.g. Claude's usage API
  is unavailable and the statusLine capture is old), the card stays honestly stale with actionable
  guidance rather than showing a false "fresh" state.

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

## Generated usage snapshots

### Snapshot location and schema

Generated snapshots are written to:

- `data/usage-snapshots/codex.json`
- `data/usage-snapshots/claude.json`

These are written atomically via a temp-file + rename to prevent partial reads. Schema:

```json
{
  "provider": "codex",
  "generatedAt": "2026-06-28T16:30:00.000Z",
  "source": {
    "script": "scripts/generate-codex-usage-snapshot.ts",
    "type": "cli"
  },
  "status": "ok",
  "staleAfterSeconds": 300,
  "approximation": true,
  "windows": [
    { "name": "5h", "percentRemaining": 70, "resetsAt": "2026-06-28T20:00:00.000Z" },
    { "name": "weekly", "percentRemaining": 45 }
  ]
}
```

`status` is one of: `ok`, `empty`, `partial`, `error`. When the provider cannot be reached, a structured `error` field is included with a stable `code` (e.g. `CLI_UNAVAILABLE`, `TIMEOUT`).

### Generation scripts

| Script | npm script | Timeout |
|---|---|---|
| `scripts/generate-codex-usage-snapshot.ts` | `npm run snapshot:codex` | 15 s |
| `scripts/generate-claude-usage-snapshot.ts` | `npm run snapshot:claude` | 30 s |

The Codex script tries the ChatGPT usage API first, falling back to the `codex app-server`; if both are unavailable an `error` snapshot is written. The Claude script tries the Anthropic OAuth usage API first (fresh `ok` snapshot, 5 min budget), falls back to the last Claude Code statusLine capture (`ok`, 15 min budget, `generatedAt` anchored to the capture time so freshness tracks real Claude Code activity), and only writes a `partial` / `MANUAL_REFRESH_REQUIRED` snapshot when neither source yields usable data.

### Refresh API

| Method | URL | Effect |
|---|---|---|
| `POST` | `/api/usage/codex/refresh` | Runs the Codex script and returns snapshot metadata |
| `POST` | `/api/usage/claude/refresh` | Runs the Claude script and returns snapshot metadata or manual state |

Refresh endpoints are POST-only (explicit user action). They never expose raw CLI stdout/stderr. Timeout constants: Codex 15 s, Claude 30 s.

Example success response:

```json
{
  "provider": "codex",
  "status": "ok",
  "generatedAt": "2026-06-28T16:31:00.000Z",
  "staleAfterSeconds": 300,
  "snapshotLocation": "data/usage-snapshots/codex.json",
  "error": null
}
```

Error response (sanitized, no raw CLI output):

```json
{
  "provider": "codex",
  "status": "error",
  "generatedAt": null,
  "staleAfterSeconds": null,
  "snapshotLocation": null,
  "error": { "code": "CLI_UNAVAILABLE", "message": "Script binary not found" }
}
```

Stable error codes: `CLI_UNAVAILABLE`, `TIMEOUT`, `NON_ZERO_EXIT`, `NO_OUTPUT`, `MALFORMED_OUTPUT`, `SNAPSHOT_READ_FAILED`, `SNAPSHOT_WRITE_FAILED`, `PERMISSION_DENIED`, `MANUAL_REFRESH_REQUIRED`, `UNSUPPORTED_AUTOMATION`.

### Claude automation limitation

Claude Code's interactive `/usage` command requires a TTY and cannot be scripted. The
`generate-claude-usage-snapshot.ts` script therefore relies on the Anthropic OAuth usage API and,
as a fallback, the Claude Code statusLine capture. When neither is available it writes a `partial`
/ `MANUAL_REFRESH_REQUIRED` snapshot whose message directs you to use Claude Code (with the
usage-glance statusLine enabled) or Claude.ai Settings > Usage. Because the statusLine fallback
anchors `generatedAt` to the capture time, a Claude card can be stale immediately after a refresh
if Claude Code has not been used recently — in that case the card shows the stale badge plus
actionable guidance rather than a false fresh state.

### Frontend refresh controls

Each provider card has a **Refresh** button. Clicking it POSTs to the corresponding refresh endpoint and shows:

- **Refreshing…** while pending
- **Updated** on success (card data reloads from `GET /api/usage`)
- A sanitized actionable error message on failure (timeout, missing CLI, manual-only, etc.)

No background polling is added; refreshes are always explicit user actions.

## What is not implemented

- **Fully automated provider-authoritative usage collection** — values shown are derived from local snapshots and are approximations, not real-time provider figures.
- **Claude automated remaining percentages** — Claude usage requires manual checking. Use Claude Code `/usage` or Claude.ai Settings > Usage. Automated collection from local JSONL/session logs is not implemented in this version.
- **Web scraping, external API calls, or data egress** — no usage data leaves the local machine.
- **Tailscale configuration** — reach the dashboard remotely via your existing Tailscale setup; no additional configuration is provided here.
