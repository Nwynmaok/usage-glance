# Deploy verification — stale usage-snapshot readiness

- **Scope:** branch `fix/usage-glance-pr16-postmerge-validation-stale-snapshot-readiness`.
- **Problem addressed:** post-merge deploy observation on 2026-07-23 — `/healthz` healthy but
  `/api/usage` marked both Codex and Claude snapshots stale, so the app-level readiness
  walkthrough could not pass (collector staleness > 5 min is treated as degraded).
- **Change summary:** a stale snapshot now bridges to an honestly actionable, sanitized state —
  `stale: true`, `state: "unknown"`, last-known windows preserved, plus a fixed guidance
  `message` derived only from the snapshot's own `staleAfterSeconds`. The card renders that
  message alongside the last-known numbers instead of showing silent, unexplained old values.
  An explicit refresh that writes a fresh snapshot clears both the stale flag and the generic
  guidance. No raw provider output, error text, or credentials enter this path (the PR #16
  sanitization guarantees are preserved and re-asserted).

## What did NOT change

- No launchd / LaunchAgent configuration was touched. Do **not** run `service:install`,
  `service:start`, `service:restart`, or `service:uninstall` as part of this verification —
  those require explicit Nathan approval.
- Tests use mocked `fs` and injected timestamps only; they never read or write the live
  `data/usage-snapshots/*.json` used by the running service.

## Local gates (run on the branch)

```bash
npm test          # 144 tests pass, incl. tests/stale-readiness.test.ts
npm run lint      # clean
npm run typecheck # clean
```

## Deploy verification (normal branch flow + explicit user-triggered refresh)

Run against a locally built server; no launchd interaction required.

1. **Build and start the branch build** (foreground, not the managed service):

   ```bash
   npm run build
   npm start &            # binds 127.0.0.1:3000
   ```

2. **Confirm health is orthogonal to freshness:**

   ```bash
   curl -fsS http://127.0.0.1:3000/healthz
   # {"status":"ok","uptime":...}
   ```

3. **Observe the stale state honestly.** With snapshots older than their `staleAfterSeconds`
   budget (the exact post-merge condition), `GET /api/usage` reports the stale-but-actionable
   shape:

   ```bash
   curl -fsS http://127.0.0.1:3000/api/usage | \
     python3 -m json.tool
   # each stale provider: "stale": true, "state": "unknown",
   #   "message": "Snapshot is older than N min. Click Refresh to update, ..."
   ```

   In the browser (`http://127.0.0.1:3000/`) each stale card shows the **stale** badge, its
   last-known numbers, and the actionable guidance line.

4. **Explicit user-triggered refresh (stale → refreshed).** Click **Refresh** on a card, or:

   ```bash
   curl -fsS -X POST http://127.0.0.1:3000/api/usage/codex/refresh
   curl -fsS http://127.0.0.1:3000/api/usage | python3 -m json.tool
   # refreshed provider now: "stale": false, "state": "ok", no generic guidance message
   ```

   If a provider's live source is unavailable (e.g. Claude usage API down + old statusLine
   capture), the refresh returns a sanitized error / the card stays honestly stale with
   guidance — it never fabricates a fresh state.

5. **Sanitization check** — confirm no raw provider text leaks in either state:

   ```bash
   curl -fsS http://127.0.0.1:3000/api/usage | \
     grep -Ei 'stdout|stderr|bearer|authorization|access_token|oauth' && echo LEAK || echo clean
   # clean
   ```

6. **Stop the foreground server** when done (`kill %1`). No service state was modified.

## Evidence

`tests/stale-readiness.test.ts` proves, fully offline with injected clocks:
stale-to-actionable bridging for both providers, preservation of existing sanitized
guidance, the stale-to-refreshed transition, card rendering of the guidance alongside
last-known windows, and absence of raw provider/credential text on every path.
