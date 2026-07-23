import { spawn } from 'child_process';
import type { SnapshotErrorCode } from './types.js';

export const CODEX_REFRESH_TIMEOUT_MS = 15_000;
export const CLAUDE_REFRESH_TIMEOUT_MS = 30_000;

export type ProcessResult =
  | { ok: true }
  | { ok: false; code: SnapshotErrorCode; message: string };

/**
 * Stable public failure messages `runScript` can emit. Production code below
 * references these literals and the fallback-boundary test consumes
 * `PROCESS_RUNNER_ERROR_PAIRS`, so the enumerated set cannot drift from what
 * ships. Keep both in sync when adding a failure path.
 */
export const PROCESS_RUNNER_ERROR_MESSAGES = {
  noCommand: 'No script command specified',
  binaryNotFound: 'Script binary not found',
  executionFailed: 'Script execution failed',
  timedOut: 'Script exceeded time limit',
  nonZeroExit: 'Script exited with non-zero code',
} as const;

/** Exhaustive (code, message) pairs `runScript` can return on failure. */
export const PROCESS_RUNNER_ERROR_PAIRS: ReadonlyArray<{ code: SnapshotErrorCode; message: string }> = [
  { code: 'CLI_UNAVAILABLE', message: PROCESS_RUNNER_ERROR_MESSAGES.noCommand },
  { code: 'CLI_UNAVAILABLE', message: PROCESS_RUNNER_ERROR_MESSAGES.binaryNotFound },
  { code: 'NON_ZERO_EXIT', message: PROCESS_RUNNER_ERROR_MESSAGES.executionFailed },
  { code: 'TIMEOUT', message: PROCESS_RUNNER_ERROR_MESSAGES.timedOut },
  { code: 'NON_ZERO_EXIT', message: PROCESS_RUNNER_ERROR_MESSAGES.nonZeroExit },
];

export async function runScript(scriptArgs: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = scriptArgs;
    if (!cmd) {
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: PROCESS_RUNNER_ERROR_MESSAGES.noCommand });
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: PROCESS_RUNNER_ERROR_MESSAGES.binaryNotFound });
      return;
    }

    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
      resolve({
        ok: false,
        code: isNotFound ? 'CLI_UNAVAILABLE' : 'NON_ZERO_EXIT',
        message: isNotFound
          ? PROCESS_RUNNER_ERROR_MESSAGES.binaryNotFound
          : PROCESS_RUNNER_ERROR_MESSAGES.executionFailed,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ ok: false, code: 'TIMEOUT', message: PROCESS_RUNNER_ERROR_MESSAGES.timedOut });
        return;
      }
      if (exitCode !== 0) {
        resolve({ ok: false, code: 'NON_ZERO_EXIT', message: PROCESS_RUNNER_ERROR_MESSAGES.nonZeroExit });
        return;
      }
      resolve({ ok: true });
    });
  });
}
