# usage-glance

Local web dashboard showing remaining Claude and Codex usage windows.

> **Bootstrap only.** This repo contains the server foundation and placeholder frontend. Usage collectors, provider percentages, the real dashboard UI, launchd integration, and Tailscale config are not implemented yet and are out of scope for this phase.

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

## Local verification

```bash
npm test          # run Vitest unit tests
npm run lint      # ESLint
npm run typecheck # tsc --noEmit (type-check without emitting)
```

## Build

```bash
npm run build
```

Bundles the client via esbuild and compiles the server with `tsc`.

## Start (production)

```bash
npm run build
npm start
```

Runs the compiled server from `dist/`. Binds to `127.0.0.1:3000` by default; override with `PORT`.

## API

### `GET /healthz`

Returns server health:

```json
{ "status": "ok", "uptime": 12.345 }
```

- `status` — always `"ok"` when the server is running
- `uptime` — seconds since process start (`process.uptime()`)

## What is not implemented

Usage collectors, provider log parsing, polling, usage cards, real dashboard data, provider percentages, launchd service, and Tailscale configuration are intentionally out of scope for this bootstrap. They will be added in future iterations.
