# S1 QA evidence — Codex refresh failure sanitization (post-merge PR #16)

Recorded 2026-07-22 on branch `feature/usage-glance-pr16-postmerge-validation`
(main at `e80d244`, sanitizer commit `fa9c284`). All evidence below is redacted:
no provider response bodies, raw JSON-RPC text, tokens, or credential-shaped
fixture values are quoted.

## Controlled failure exercise (offline test seam only)

- **Test identifier:** `tests/codex-refresh-sanitizer-e2e.test.ts` (9 tests).
- **Mechanism:** the real generator script runs in a temp sandbox with `CODEX_BIN`
  pointed at a fake JSON-RPC app-server and an empty `CODEX_HOME` (direct usage-API
  path returns `AUTH_REQUIRED` locally, no network). The fake server returns synthetic
  errors carrying a runtime-assembled credential-shaped substring; the fixture reaches
  the fake process via env var and is never written to any script, log, or artifact.
- **Expected stable public messages (observed):**
  - generic RPC failure → `NON_ZERO_EXIT` / "codex app-server returned an error"
  - auth-flavored RPC failure → `AUTH_REQUIRED` / "codex login required", which the UI
    maps to "Codex not signed in. Run `npm run codex:login` once to authenticate."
- **Surfaces inspected, with explicit non-leak assertions** (boolean `includes` checks
  so failures cannot print the fixture):
  1. Generated snapshot file bytes (`data/usage-snapshots/codex.json` in the sandbox):
     stable error only; synthetic secret, bearer-shaped substring, raw panic text, and
     synthetic account id all asserted absent.
  2. `POST /api/usage/codex/refresh` response (fastify inject, script spawn stubbed,
     snapshot path pointed at the sandbox): HTTP 200, `status: "error"`, stable
     code/message; full body asserted free of the fixture.
  3. `GET /api/usage` bridged state: codex `state: "unavailable"` with the stable
     message; full body asserted free of the fixture.
  4. UI refresh state: `sanitizeRefreshError` asserted non-empty and fixture-free for
     every server-originated (code, message) pair on the codex path — the pair list is
     derived from exported mappings in the modules that emit them (`codex-usage-api.ts`,
     `codex-app-server.ts`, `process-runner.ts`, and the refresh route in `usage.ts`), so it
     cannot silently drift from production. Those mappings enumerate their fixed-literal
     pairs exhaustively (19 today; 23 enumerated pairs in total once the HTTP-family
     witnesses below are included). The one non-literal failure — codex
     usage-API's templated `HTTP_ERROR` family, whose message `Codex usage API returned HTTP
     ${status}` interpolates only the numeric status, never a response body — is unbounded
     over status, so it is carried in the enumerated list by concrete witnesses (404/418/500/503,
     including the teapot 418 QA previously flagged as missing) and additionally proven safe
     *as a family* by a dedicated test that sanitizes it across those witnesses plus further
     statuses (400/429/502/599). Rendered `renderRefreshSection` HTML shows the stable message
     and is fixture-free.
- **Useful-error criterion:** the exercised failures surface a non-blank, actionable
  code/message pair (auth failures tell the user how to log in), not an opaque failure.

## Gates

| Command | Result |
| --- | --- |
| `npm test` | pass — 10 files, 137 tests |
| `npm run lint` | pass — no findings |
| `npm run typecheck` | pass — no errors |

## Live local service spot-check (read-only; no forced failure, no config changes)

| Command | Result |
| --- | --- |
| `curl --fail http://127.0.0.1:3000/healthz` | HTTP 200, `{"status":"ok","uptime":<seconds>}` (service up ~2.2 days) |
| `curl --fail http://127.0.0.1:3000/api/usage` | HTTP 200, JSON array of two provider snapshots (`codex`, `claude`), both `state: "ok"`, `stale: false`, source "Provider usage API"; payload contains only window names, percent-remaining values, and reset timestamps — no tokens or provider error text |

No launchd/service configuration, production snapshot data, or provider account state
was modified to produce any of this evidence.

## DevOps handoff

Post-merge review (`docs/validation/pr-16-postmerge-sanitizer-review.md`) and this QA
evidence are complete for the PR #16 sanitizer fix. The originally blocked feature
**`usage-glance-refresh-generated-usage-snapshots`** is ready for DevOps to rerun its
final deploy-readiness check; this task does not clear that blocker itself.
