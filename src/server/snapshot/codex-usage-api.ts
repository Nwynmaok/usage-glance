import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveCodexHome } from './codex-bin.js';
import type { RateLimitSnapshot, RateLimitWindow, RateLimitsResult } from './codex-app-server.js';
import type { SnapshotErrorCode } from './types.js';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Stable public failure messages this module can emit. Production code below
 * references these literals and the fallback-boundary test consumes
 * `CODEX_USAGE_API_ERROR_PAIRS`, so the enumerated set cannot drift from what
 * ships. Keep both in sync when adding a failure path.
 */
export const CODEX_USAGE_API_ERROR_MESSAGES = {
  noCredentials: 'No codex OAuth credentials found (run codex login)',
  timedOut: 'Codex usage API timed out',
  requestFailed: 'Codex usage API request failed',
  tokenRejected: 'Codex usage API rejected the OAuth token',
  nonJson: 'Codex usage API returned non-JSON output',
  missingRateLimit: 'Codex usage API response missing rate_limit',
} as const;

/** The one templated failure message; status code is the only interpolated part. */
export function codexUsageApiHttpErrorMessage(status: number): string {
  return `Codex usage API returned HTTP ${status}`;
}

/** Exhaustive (code, message) pairs `fetchCodexUsageFromApi` can return. */
export const CODEX_USAGE_API_ERROR_PAIRS: ReadonlyArray<{ code: SnapshotErrorCode; message: string }> = [
  { code: 'AUTH_REQUIRED', message: CODEX_USAGE_API_ERROR_MESSAGES.noCredentials },
  { code: 'TIMEOUT', message: CODEX_USAGE_API_ERROR_MESSAGES.timedOut },
  { code: 'HTTP_ERROR', message: CODEX_USAGE_API_ERROR_MESSAGES.requestFailed },
  { code: 'AUTH_REQUIRED', message: CODEX_USAGE_API_ERROR_MESSAGES.tokenRejected },
  { code: 'HTTP_ERROR', message: codexUsageApiHttpErrorMessage(500) },
  { code: 'MALFORMED_OUTPUT', message: CODEX_USAGE_API_ERROR_MESSAGES.nonJson },
  { code: 'MALFORMED_OUTPUT', message: CODEX_USAGE_API_ERROR_MESSAGES.missingRateLimit },
];

export interface CodexAuth {
  accessToken: string;
  accountId: string | null;
}

/** Read the ChatGPT OAuth token codex login persists in CODEX_HOME/auth.json. */
export function readCodexAuth(): CodexAuth | null {
  try {
    const raw = readFileSync(join(resolveCodexHome(), 'auth.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { tokens?: { access_token?: unknown; account_id?: unknown } };
    const tokens = parsed.tokens;
    if (!tokens || typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
      return null;
    }
    return {
      accessToken: tokens.access_token,
      accountId: typeof tokens.account_id === 'string' ? tokens.account_id : null,
    };
  } catch {
    return null;
  }
}

interface WhamWindow {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;
}

function toRateLimitWindow(value: unknown): RateLimitWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const w = value as WhamWindow;
  if (typeof w.used_percent !== 'number') return null;
  return {
    usedPercent: w.used_percent,
    resetsAt: typeof w.reset_at === 'number' ? w.reset_at : null,
    windowDurationMins:
      typeof w.limit_window_seconds === 'number' ? Math.round(w.limit_window_seconds / 60) : null,
  };
}

/** Extract a RateLimitSnapshot (app-server shape) from a wham/usage response body. */
export function parseCodexUsageResponse(data: unknown): RateLimitSnapshot | null {
  if (typeof data !== 'object' || data === null) return null;
  const body = data as { plan_type?: unknown; rate_limit?: { primary_window?: unknown; secondary_window?: unknown } | null };
  const rateLimit = body.rate_limit;
  if (typeof rateLimit !== 'object' || rateLimit === null) return null;
  return {
    primary: toRateLimitWindow(rateLimit.primary_window),
    secondary: toRateLimitWindow(rateLimit.secondary_window),
    planType: typeof body.plan_type === 'string' ? body.plan_type : null,
  };
}

/**
 * Pull rate limits straight from the ChatGPT usage endpoint using the token
 * codex login persisted — the same endpoint the codex CLI calls internally,
 * without spawning a process. Does not refresh tokens: a stale token comes
 * back AUTH_REQUIRED and the caller falls back to the app-server path, which
 * refreshes auth.json as a side effect and heals this path.
 */
export async function fetchCodexUsageFromApi(
  timeoutMs = DEFAULT_TIMEOUT_MS,
  auth: CodexAuth | null = readCodexAuth(),
): Promise<RateLimitsResult> {
  if (!auth) {
    return { ok: false, code: 'AUTH_REQUIRED', message: CODEX_USAGE_API_ERROR_MESSAGES.noCredentials };
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${auth.accessToken}` };
  if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId;

  let response: Response;
  try {
    response = await fetch(USAGE_URL, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'HTTP_ERROR',
      message: aborted ? CODEX_USAGE_API_ERROR_MESSAGES.timedOut : CODEX_USAGE_API_ERROR_MESSAGES.requestFailed,
    };
  }

  // Status codes only in error messages — response bodies never reach snapshot state.
  if (response.status === 401 || response.status === 403) {
    return { ok: false, code: 'AUTH_REQUIRED', message: CODEX_USAGE_API_ERROR_MESSAGES.tokenRejected };
  }
  if (!response.ok) {
    return { ok: false, code: 'HTTP_ERROR', message: codexUsageApiHttpErrorMessage(response.status) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'MALFORMED_OUTPUT', message: CODEX_USAGE_API_ERROR_MESSAGES.nonJson };
  }

  const snapshot = parseCodexUsageResponse(body);
  if (!snapshot) {
    return { ok: false, code: 'MALFORMED_OUTPUT', message: CODEX_USAGE_API_ERROR_MESSAGES.missingRateLimit };
  }
  return { ok: true, snapshot };
}
