# Post-merge privacy review — PR #16 Codex refresh sanitizer

- **Scope:** merged sanitizer commit `fa9c284` (PR #16), validated on `main` at `e80d244` (which layered PR #17's direct-API path on top).
- **Reviewed:** 2026-07-22, on branch `feature/usage-glance-pr16-postmerge-validation`.
- **Question:** can raw Codex JSON-RPC/provider error text or credential-shaped data reach the generated snapshot, the refresh API response, or the browser UI when a Codex refresh fails?

## Privacy boundary

Every codex failure funnels through a `RateLimitsResult` / `ProcessResult` of shape
`{ ok: false, code: SnapshotErrorCode, message: string }`, and every `message` on the codex
refresh path is a **compile-time string literal** (occasionally plus an HTTP status number).
No branch interpolates provider-supplied text into that shape:

| Layer | File | Behavior on failure |
| --- | --- | --- |
| Direct usage API | `src/server/snapshot/codex-usage-api.ts` | 401/403 → `AUTH_REQUIRED` "Codex usage API rejected the OAuth token"; other non-OK → `HTTP_ERROR` with status code only; fetch/timeout/JSON failures → literal messages. Response bodies are parsed for windows or discarded; they are never copied into the result. |
| App-server fallback | `src/server/snapshot/codex-app-server.ts` | JSON-RPC `msg.error.message` is only *tested* (`/authentication required/i`) to pick between `AUTH_REQUIRED` "codex login required" and `NON_ZERO_EXIT` "codex app-server returned an error". The raw text is never passed downstream — this is the PR #16 fix. |
| Generator script | `scripts/generate-codex-usage-snapshot.ts` | `makeErrorSnapshot(code, message)` persists exactly the stable pair above via `writeSnapshotAtomically`; stdout/stderr of the codex process are not captured into the snapshot. |
| Refresh route | `src/server/routes/usage.ts` | `POST /api/usage/codex/refresh` returns either the `ProcessResult` literals from `process-runner.ts` (script spawned with `stdio` ignored, so child output cannot leak) or the generated snapshot's stored `error` field. |
| Read route | `src/server/routes/usage.ts` + `src/server/snapshot/bridge.ts` | `GET /api/usage` bridges the snapshot; `message` comes from `snap.message ?? snap.error.message` — both already stable literals. |
| UI | `src/client/main.ts` | `sanitizeRefreshError(code, fallback)` maps known codes to user-safe copy. Unknown codes fall back to the API message — safe **because** every server-originated message on this path is a stable literal (enumerated and asserted in the test below). |

Conclusion: the input→output boundary is closed at the innermost layer (both codex sources),
so no downstream surface can re-acquire raw provider text. The only provider-derived values
that survive into public state are numeric usage percentages, reset timestamps, plan-type
string, and HTTP status codes.

## Residual risks (noted, not blocking)

- `sanitizeRefreshError`'s default branch echoes the server message for unknown codes. Safe
  today (all server messages are literals); a future code path that interpolates provider text
  would leak through it. The e2e test pins every current server-originated pair to catch this.
- `renderCard`/`renderRefreshSection` interpolate into `innerHTML` without escaping; inputs are
  the stable literals above, so no injection vector exists on this path today.

## Evidence

`tests/codex-refresh-sanitizer-e2e.test.ts` proves the boundary end-to-end, fully offline:
the **real** `scripts/generate-codex-usage-snapshot.ts` runs against a fake `codex app-server`
(via `CODEX_BIN`) that returns a synthetic JSON-RPC error carrying a runtime-assembled
credential-shaped substring, with an empty `CODEX_HOME` so the direct-API path short-circuits
without any network call. The snapshot file bytes, `POST /api/usage/codex/refresh` payload,
`GET /api/usage` payload, and rendered UI refresh HTML are each asserted to contain the stable
code/message and none of the synthetic raw text. No raw fixture content is committed as a
credential-shaped literal or printed by passing or failing assertions (boolean `includes`
checks only).
