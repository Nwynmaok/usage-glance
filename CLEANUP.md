# Todolist artifact cleanup

**Date:** 2026-06-26  
**Branch:** `feature/todolist-docs-and-local-config`  
**Task spec:** `usage-glance-todolist-artifact-cleanup`

## Post-healthz baseline used

Commit `3de5410` — "fix: relax REPO_ROOT basename assertion to support scratch worktrees"

This commit is the last on the `feature/todolist-docs-and-local-config` branch before any Todolist-specific work began. It includes:
- `GET /healthz` endpoint (added in `24367f1`)
- Placeholder frontend (added in `41fecb3`)
- GitHub Actions CI (added in `a85093d`)
- launchd plist generation and lifecycle CLI (added in `c6c7e9d`, `120f427`)
- launchd service docs in README (added in `6476a0a`)

## Removed Todolist artifacts

### Files deleted (pure additions in todolist commits)

| File | Introduced in |
|------|--------------|
| `src/server/todolist/config.ts` | `87d9e99` |
| `src/server/todolist/notion-client.ts` | `faf66f8` |
| `src/server/todolist/notion-normalize.ts` | `87d9e99` |
| `src/server/todolist/paths.ts` | `87d9e99` |
| `src/server/todolist/scoring.ts` | `87d9e99` |
| `src/server/todolist/store.ts` | `87d9e99` |
| `src/server/todolist/types.ts` | `87d9e99` |
| `src/server/routes/todolist.ts` | `faf66f8` |
| `tests/todolist.config.test.ts` | `87d9e99` |
| `tests/todolist.notion-normalize.test.ts` | `87d9e99` |
| `tests/todolist.routes.test.ts` | `faf66f8` |
| `tests/todolist.scoring.test.ts` | `87d9e99` |
| `tests/todolist.store.test.ts` | `87d9e99` |

### Files reverted to baseline `3de5410`

| File | What changed |
|------|-------------|
| `src/server/app.ts` | Removed todolist route registration (`faf66f8`) |
| `src/client/main.ts` | Reverted from Todolist Coach dashboard to placeholder (`b152112`, `41b4d11`) |
| `src/client/styles.css` | Reverted from Todolist-specific CSS to placeholder styles (`b152112`) |
| `public/index.html` | Reverted title from "Todolist Coach" to "Usage Glance" (`b152112`) |
| `README.md` | Removed Todolist Coach setup, config, and API sections (`8b99718`) |

## Preserved artifacts and rationale

All `usage-glance`-legitimate work is preserved:

| Artifact | Why kept |
|----------|---------|
| `GET /healthz` endpoint + `tests/health.test.ts` | Core usage-glance service health check |
| `scripts/launchd.mjs`, `scripts/launchd.d.mts`, `scripts/launchd-start.zsh` | usage-glance LaunchAgent lifecycle CLI |
| `tests/launchd.test.ts` | Tests for usage-glance launchd plist generation |
| `src/client/main.ts` (placeholder) | usage-glance frontend scaffold (not Todolist) |
| `src/client/styles.css` (minimal) | usage-glance base styles |
| `README.md` launchd section | Documents `com.nwynmaok.usage-glance` service on Nathan's Mac Mini |
| `package.json` `service:*` scripts | usage-glance service management commands |

## Regression check

`tests/no-todolist-artifacts.test.ts` — Vitest test that greps all tracked files for
Todolist-specific terms. Fails if any are found outside this file.

Allowlist: `CLEANUP.md` (this file — documents the removed artifacts).

## False positives intentionally retained

None. All removed references were confirmed Todolist-specific via diff evidence against `3de5410`.

## Standalone Todolist repo

`/Users/wynclaw/projects/todolist` was not modified by this cleanup.
