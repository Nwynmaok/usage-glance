import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { resolveCodexBin, resolveCodexHome } from './codex-bin.js';
import type { SnapshotErrorCode } from './types.js';

/** A single usage window as reported by codex (mirrors RateLimitWindow). */
export interface RateLimitWindow {
  usedPercent: number;
  resetsAt?: number | null;
  windowDurationMins?: number | null;
}

/** Mirrors codex app-server `RateLimitSnapshot`. */
export interface RateLimitSnapshot {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: string | null;
  limitName?: string | null;
}

export type RateLimitsResult =
  | { ok: true; snapshot: RateLimitSnapshot }
  | { ok: false; code: SnapshotErrorCode; message: string };

/**
 * Every stable public failure message this module can emit. Production code
 * below references these literals and the test's fallback-boundary proof
 * consumes `CODEX_APP_SERVER_ERROR_PAIRS`, so the enumerated set cannot drift
 * from what ships. Keep both in sync when adding a failure path.
 */
export const CODEX_APP_SERVER_ERROR_MESSAGES = {
  cliUnavailable: 'codex CLI not available',
  timedOut: 'codex app-server timed out',
  failedToStart: 'codex app-server failed to start',
  pipesUnavailable: 'codex app-server pipes unavailable',
  loginRequired: 'codex login required',
  returnedError: 'codex app-server returned an error',
  missingRateLimits: 'rate limits response missing rateLimits',
} as const;

/** Exhaustive (code, message) pairs `readCodexRateLimits` can return. */
export const CODEX_APP_SERVER_ERROR_PAIRS: ReadonlyArray<{ code: SnapshotErrorCode; message: string }> = [
  { code: 'CLI_UNAVAILABLE', message: CODEX_APP_SERVER_ERROR_MESSAGES.cliUnavailable },
  { code: 'TIMEOUT', message: CODEX_APP_SERVER_ERROR_MESSAGES.timedOut },
  { code: 'NON_ZERO_EXIT', message: CODEX_APP_SERVER_ERROR_MESSAGES.failedToStart },
  { code: 'NON_ZERO_EXIT', message: CODEX_APP_SERVER_ERROR_MESSAGES.pipesUnavailable },
  { code: 'AUTH_REQUIRED', message: CODEX_APP_SERVER_ERROR_MESSAGES.loginRequired },
  { code: 'NON_ZERO_EXIT', message: CODEX_APP_SERVER_ERROR_MESSAGES.returnedError },
  { code: 'MALFORMED_OUTPUT', message: CODEX_APP_SERVER_ERROR_MESSAGES.missingRateLimits },
];

interface JsonRpcMessage {
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
  method?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Launch `codex app-server`, perform the JSON-RPC handshake, and read the
 * account rate limits. Requires persisted auth in CODEX_HOME (run `codex login`
 * once). The app-server speaks newline-delimited JSON-RPC over stdio — no TTY.
 */
export function readCodexRateLimits(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RateLimitsResult> {
  return new Promise((resolve) => {
    const bin = resolveCodexBin();
    const env = { ...process.env, CODEX_HOME: resolveCodexHome(), TERM: 'dumb' };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'], env });
    } catch {
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: CODEX_APP_SERVER_ERROR_MESSAGES.cliUnavailable });
      return;
    }

    let settled = false;
    const finish = (result: RateLimitsResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGTERM');
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ ok: false, code: 'TIMEOUT', message: CODEX_APP_SERVER_ERROR_MESSAGES.timedOut }),
      timeoutMs,
    );

    child.on('error', (err) => {
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      finish({
        ok: false,
        code: isNotFound ? 'CLI_UNAVAILABLE' : 'NON_ZERO_EXIT',
        message: isNotFound
          ? CODEX_APP_SERVER_ERROR_MESSAGES.cliUnavailable
          : CODEX_APP_SERVER_ERROR_MESSAGES.failedToStart,
      });
    });

    const stdin = child.stdin;
    const stdout = child.stdout;
    if (!stdin || !stdout) {
      finish({ ok: false, code: 'NON_ZERO_EXIT', message: CODEX_APP_SERVER_ERROR_MESSAGES.pipesUnavailable });
      return;
    }

    const send = (method: string, id?: number): void => {
      const msg: Record<string, unknown> = { jsonrpc: '2.0', method };
      if (id !== undefined) msg['id'] = id;
      stdin.write(JSON.stringify(msg) + '\n');
    };

    const sendInit = (): void => {
      stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'initialize',
          id: 1,
          params: { clientInfo: { name: 'usage-glance', version: '0.1.0' }, apiVersion: 'v2' },
        }) + '\n',
      );
    };

    const RATE_LIMITS_ID = 2;
    const rl = createInterface({ input: stdout });
    rl.on('line', (line) => {
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line) as JsonRpcMessage;
      } catch {
        return; // ignore non-JSON noise
      }

      if (msg.id === 1 && msg.result) {
        // initialize acked — declare ready, then request rate limits
        send('initialized');
        send('account/rateLimits/read', RATE_LIMITS_ID);
        return;
      }

      if (msg.id === RATE_LIMITS_ID) {
        if (msg.error) {
          const authNeeded = /authentication required/i.test(msg.error.message);
          finish({
            ok: false,
            code: authNeeded ? 'AUTH_REQUIRED' : 'NON_ZERO_EXIT',
            message: authNeeded
              ? CODEX_APP_SERVER_ERROR_MESSAGES.loginRequired
              : CODEX_APP_SERVER_ERROR_MESSAGES.returnedError,
          });
          return;
        }
        const result = msg.result as { rateLimits?: RateLimitSnapshot } | undefined;
        if (!result || typeof result !== 'object' || !result.rateLimits) {
          finish({ ok: false, code: 'MALFORMED_OUTPUT', message: CODEX_APP_SERVER_ERROR_MESSAGES.missingRateLimits });
          return;
        }
        finish({ ok: true, snapshot: result.rateLimits });
      }
    });

    sendInit();
  });
}
