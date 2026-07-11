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
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: 'codex CLI not available' });
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
      () => finish({ ok: false, code: 'TIMEOUT', message: 'codex app-server timed out' }),
      timeoutMs,
    );

    child.on('error', (err) => {
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      finish({
        ok: false,
        code: isNotFound ? 'CLI_UNAVAILABLE' : 'NON_ZERO_EXIT',
        message: isNotFound ? 'codex CLI not available' : 'codex app-server failed to start',
      });
    });

    const stdin = child.stdin;
    const stdout = child.stdout;
    if (!stdin || !stdout) {
      finish({ ok: false, code: 'NON_ZERO_EXIT', message: 'codex app-server pipes unavailable' });
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
            message: msg.error.message,
          });
          return;
        }
        const result = msg.result as { rateLimits?: RateLimitSnapshot } | undefined;
        if (!result || typeof result !== 'object' || !result.rateLimits) {
          finish({ ok: false, code: 'MALFORMED_OUTPUT', message: 'rate limits response missing rateLimits' });
          return;
        }
        finish({ ok: true, snapshot: result.rateLimits });
      }
    });

    sendInit();
  });
}
