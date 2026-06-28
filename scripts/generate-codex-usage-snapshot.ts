import { spawnSync } from 'child_process';
import { writeSnapshotAtomically } from '../src/server/snapshot/atomic-writer.js';
import { parseCodexStatusText } from '../src/server/collectors/codex.js';
import type { GeneratedUsageSnapshot, SnapshotErrorCode } from '../src/server/snapshot/types.js';

const SNAPSHOT_PATH = 'data/usage-snapshots/codex.json';
const SCRIPT_NAME = 'scripts/generate-codex-usage-snapshot.ts';
const CLI_TIMEOUT_MS = 10_000;

function makeErrorSnapshot(code: SnapshotErrorCode, message: string): GeneratedUsageSnapshot {
  return {
    provider: 'codex',
    generatedAt: new Date().toISOString(),
    source: { script: SCRIPT_NAME, type: 'cli' },
    status: 'error',
    staleAfterSeconds: 300,
    approximation: true,
    error: { code, message },
  };
}

function run(): void {
  const result = spawnSync('codex', ['/status'], {
    encoding: 'utf-8',
    timeout: CLI_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    const errorCode: SnapshotErrorCode = code === 'ENOENT' ? 'CLI_UNAVAILABLE' : 'NON_ZERO_EXIT';
    writeSnapshotAtomically(SNAPSHOT_PATH, makeErrorSnapshot(errorCode, 'codex CLI not available'));
    return;
  }

  if (result.signal === 'SIGTERM' || result.status === null) {
    writeSnapshotAtomically(SNAPSHOT_PATH, makeErrorSnapshot('TIMEOUT', 'codex /status timed out'));
    return;
  }

  if (result.status !== 0) {
    writeSnapshotAtomically(SNAPSHOT_PATH, makeErrorSnapshot('NON_ZERO_EXIT', 'codex /status returned non-zero exit'));
    return;
  }

  const stdout = result.stdout ?? '';
  if (!stdout.trim()) {
    writeSnapshotAtomically(SNAPSHOT_PATH, makeErrorSnapshot('NO_OUTPUT', 'codex /status produced no output'));
    return;
  }

  const windows = parseCodexStatusText(stdout);
  if (windows.length === 0) {
    writeSnapshotAtomically(SNAPSHOT_PATH, {
      provider: 'codex',
      generatedAt: new Date().toISOString(),
      source: { script: SCRIPT_NAME, type: 'cli' },
      status: 'empty',
      staleAfterSeconds: 300,
      approximation: true,
      message: 'No usage windows found in codex /status output',
    });
    return;
  }

  writeSnapshotAtomically(SNAPSHOT_PATH, {
    provider: 'codex',
    generatedAt: new Date().toISOString(),
    source: { script: SCRIPT_NAME, type: 'cli' },
    status: 'ok',
    staleAfterSeconds: 300,
    approximation: true,
    windows: windows.map((w) => ({
      name: w.name,
      percentRemaining: w.percentRemaining,
      resetsAt: w.resetAt,
    })),
  });
}

run();
