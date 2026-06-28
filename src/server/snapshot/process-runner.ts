import { spawn } from 'child_process';
import type { SnapshotErrorCode } from './types.js';

export const CODEX_REFRESH_TIMEOUT_MS = 15_000;
export const CLAUDE_REFRESH_TIMEOUT_MS = 30_000;

export type ProcessResult =
  | { ok: true }
  | { ok: false; code: SnapshotErrorCode; message: string };

export async function runScript(scriptArgs: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const [cmd, ...args] = scriptArgs;
    if (!cmd) {
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: 'No script command specified' });
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve({ ok: false, code: 'CLI_UNAVAILABLE', message: 'Script binary not found' });
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
        message: isNotFound ? 'Script binary not found' : 'Script execution failed',
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ ok: false, code: 'TIMEOUT', message: 'Script exceeded time limit' });
        return;
      }
      if (exitCode !== 0) {
        resolve({ ok: false, code: 'NON_ZERO_EXIT', message: 'Script exited with non-zero code' });
        return;
      }
      resolve({ ok: true });
    });
  });
}
