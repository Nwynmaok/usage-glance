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

## Todolist Coach

The Todolist Coach is a local-first module hosted inside this app shell. It connects to a Notion database to fetch and prioritize your tasks, then serves a mobile-readable focus and cadence dashboard at `http://127.0.0.1:3000`. Task data goes only to the Notion API and local files; nothing is returned to the browser beyond task metadata needed for the local UI, and no tokens or task data are ever committed to the repo.

### Notion integration setup

1. Go to [https://www.notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create a new **internal integration** for your workspace.
2. Copy the **Internal Integration Token** (starts with `ntn_` or `secret_`).
3. Open your task database in Notion, click the `...` menu → **Connections**, and connect your integration.
4. Copy the **Database ID** from the database URL: `https://www.notion.so/<workspace>/<DATABASE_ID>?v=...`.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TODOLIST_NOTION_TOKEN` | Yes | Notion internal integration token |
| `TODOLIST_NOTION_DATABASE_ID` | Yes | Notion database ID |
| `TODOLIST_CONFIG_PATH` | No | Override path for the local config file |
| `TODOLIST_DATA_DIR` | No | Override path for the local state/cache directory |

Environment variables take precedence over the local config file.

### Local config file

Optional config file path (not repo-tracked, recommended location):

```
~/.config/usage-glance/todolist.config.json
```

Minimal example (fill in your values, never commit real tokens):

```json
{
  "notion": {
    "token": "ntn_YOUR_TOKEN_HERE",
    "databaseId": "YOUR_DATABASE_ID_HERE",
    "propertyMap": {
      "title": "Name",
      "status": "Status",
      "priority": "Priority",
      "dueDate": "Due Date"
    }
  },
  "focus": {
    "dailyCap": 5
  }
}
```

The `propertyMap` keys map to your actual Notion property names. Only `title` is required; all other fields are optional and omitted fields are tolerated gracefully.

### Local state and cache

Default local state directory (outside the repo, created on first write):

```
~/.local/state/usage-glance/todolist/
```

Two files are managed here:

- `cache.json` — last successful Notion load and normalized task snapshot. If Notion is unavailable, the server serves this stale cache with `degraded: true` and records the error.
- `cadence-state.json` — daily/weekly cadence completion records and selected focus IDs.

**Privacy:** tokens and task data live only in your local env/config and this directory. They are not returned to the browser beyond the task metadata the UI needs, never written to client bundles, never logged, and never committed to the repo.

### API summary

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/todolist/status` | Configuration and freshness state; never exposes tokens |
| `POST` | `/api/todolist/sync` | Fetches Notion, updates `cache.json`, returns focus recommendations |
| `GET` | `/api/todolist/focus` | Returns focus recommendations from cache; does not call Notion |
| `POST` | `/api/todolist/cadence` | Records cadence events (`daily-startup-complete`, `daily-shutdown-complete`, `weekly-review-complete`, `select-focus`) |

**`GET /api/todolist/status`** example response:

```json
{
  "configured": true,
  "hasToken": true,
  "hasDatabaseId": true,
  "mappingWarnings": [],
  "lastSyncAt": "2026-06-23T22:20:00.000Z",
  "degraded": false,
  "error": null
}
```

**`POST /api/todolist/sync`** triggers an explicit Notion read. If Notion fails, the last cache is preserved and `degraded: true` is returned with a visible error — stale data is never silently served as fresh.

**`GET /api/todolist/focus`** serves from cache only (no Notion call). If no cache exists, it returns the configuration state and prompts you to run sync.

**`POST /api/todolist/cadence`** example request:

```json
{ "event": "daily-startup-complete", "selectedFocusPageIds": ["notion-page-id"] }
```

### Verification

```bash
npm test          # run Vitest unit tests
npm run lint      # ESLint
npm run typecheck # tsc --noEmit (type-check without emitting)
npm run build     # bundle client and compile server
```

## What is not implemented

Usage collectors, provider log parsing, polling, usage cards, real dashboard data, and Tailscale configuration are intentionally out of scope for the current iteration. They will be added in future iterations. When provider percentages are introduced, they will be approximations derived from local data and will not reflect provider-authoritative figures.
