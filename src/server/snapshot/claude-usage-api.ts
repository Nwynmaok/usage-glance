import { readClaudeOAuthCredentials, type ClaudeOAuthCredentials } from './claude-oauth-creds.js';
import type { GeneratedSnapshotWindow, SnapshotErrorCode } from './types.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
// Without a claude-code User-Agent the endpoint routes requests into an
// aggressively rate-limited bucket and 429s persistently
// (anthropics/claude-code#31021).
const USER_AGENT = `claude-code/${process.env['CLAUDE_CODE_UA_VERSION'] ?? '2.1.207'}`;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ClaudeUsageResult =
  | { ok: true; windows: GeneratedSnapshotWindow[] }
  | { ok: false; code: SnapshotErrorCode; message: string };

/** Known window keys in the oauth/usage response, in display order. */
const WINDOW_NAMES: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'weekly',
  seven_day_opus: 'weekly-opus',
};

interface UsageWindowBody {
  utilization?: unknown;
  resets_at?: unknown;
}

function toWindow(name: string, value: unknown): GeneratedSnapshotWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as UsageWindowBody;
  if (typeof body.utilization !== 'number') return null;
  const window: GeneratedSnapshotWindow = {
    name,
    percentRemaining: Math.max(0, Math.min(100, Math.round(100 - body.utilization))),
    unit: 'percent',
  };
  if (typeof body.resets_at === 'string') {
    const d = new Date(body.resets_at);
    if (!isNaN(d.getTime())) window.resetsAt = d.toISOString();
  }
  return window;
}

/** Extract usage windows from an oauth/usage response body. */
export function parseClaudeUsageResponse(data: unknown): GeneratedSnapshotWindow[] {
  if (typeof data !== 'object' || data === null) return [];
  const entries = Object.entries(data as Record<string, unknown>);
  const known = Object.keys(WINDOW_NAMES);
  // Known windows first in a stable order, then anything the API adds later.
  entries.sort(([a], [b]) => {
    const ai = known.indexOf(a);
    const bi = known.indexOf(b);
    return (ai === -1 ? known.length : ai) - (bi === -1 ? known.length : bi);
  });
  const windows: GeneratedSnapshotWindow[] = [];
  for (const [key, value] of entries) {
    const window = toWindow(WINDOW_NAMES[key] ?? key.replace(/_/g, '-'), value);
    if (window) windows.push(window);
  }
  return windows;
}

/**
 * Pull authoritative usage windows straight from the Anthropic OAuth usage
 * endpoint, reusing the token Claude Code already persisted. Read-only against
 * the credential store: an expired token is reported as AUTH_REQUIRED (the
 * caller falls back) rather than refreshed here, so we never consume the
 * CLI's refresh token.
 */
export async function fetchClaudeUsageFromApi(
  timeoutMs = DEFAULT_TIMEOUT_MS,
  credentials: ClaudeOAuthCredentials | null = readClaudeOAuthCredentials(),
): Promise<ClaudeUsageResult> {
  if (!credentials) {
    return { ok: false, code: 'AUTH_REQUIRED', message: 'No Claude Code OAuth credentials found' };
  }
  if (credentials.expiresAt !== null && credentials.expiresAt <= Date.now()) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Claude Code OAuth token expired; using Claude Code refreshes it',
    };
  }

  let response: Response;
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'TimeoutError';
    return {
      ok: false,
      code: aborted ? 'TIMEOUT' : 'HTTP_ERROR',
      message: aborted ? 'Claude usage API timed out' : 'Claude usage API request failed',
    };
  }

  // Status codes only in error messages — response bodies never reach snapshot state.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Claude usage API rejected the OAuth token; using Claude Code refreshes it',
    };
  }
  if (!response.ok) {
    return { ok: false, code: 'HTTP_ERROR', message: `Claude usage API returned HTTP ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: 'MALFORMED_OUTPUT', message: 'Claude usage API returned non-JSON output' };
  }

  const windows = parseClaudeUsageResponse(body);
  if (windows.length === 0) {
    return { ok: false, code: 'MALFORMED_OUTPUT', message: 'Claude usage API response had no usage windows' };
  }
  return { ok: true, windows };
}
