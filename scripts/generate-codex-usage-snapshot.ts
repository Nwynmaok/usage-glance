import { writeSnapshotAtomically } from '../src/server/snapshot/atomic-writer.js';
import { readCodexRateLimits, type RateLimitWindow } from '../src/server/snapshot/codex-app-server.js';
import type { GeneratedUsageSnapshot, GeneratedSnapshotWindow, SnapshotErrorCode } from '../src/server/snapshot/types.js';

const SNAPSHOT_PATH = 'data/usage-snapshots/codex.json';
const SCRIPT_NAME = 'scripts/generate-codex-usage-snapshot.ts';

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

/** codex windows are named by duration; fall back to position. */
function windowName(durationMins: number | null | undefined, fallback: string): string {
  if (durationMins == null) return fallback;
  if (durationMins === 300) return '5h';
  if (durationMins === 10080) return 'weekly';
  if (durationMins % 1440 === 0) return `${durationMins / 1440}d`;
  if (durationMins % 60 === 0) return `${durationMins / 60}h`;
  return `${durationMins}m`;
}

/** Unix timestamp (s or ms) -> ISO string. */
function toIso(resetsAt: number | null | undefined): string | undefined {
  if (resetsAt == null) return undefined;
  const ms = resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function toWindow(w: RateLimitWindow | null | undefined, fallbackName: string): GeneratedSnapshotWindow | null {
  if (!w || typeof w.usedPercent !== 'number') return null;
  const window: GeneratedSnapshotWindow = {
    name: windowName(w.windowDurationMins, fallbackName),
    percentRemaining: Math.max(0, Math.min(100, 100 - w.usedPercent)),
    unit: 'percent',
  };
  const resetsAt = toIso(w.resetsAt);
  if (resetsAt) window.resetsAt = resetsAt;
  return window;
}

async function run(): Promise<void> {
  const result = await readCodexRateLimits();

  if (!result.ok) {
    writeSnapshotAtomically(SNAPSHOT_PATH, makeErrorSnapshot(result.code, result.message));
    return;
  }

  const { primary, secondary } = result.snapshot;
  const windows = [toWindow(primary, 'primary'), toWindow(secondary, 'secondary')].filter(
    (w): w is GeneratedSnapshotWindow => w !== null,
  );

  if (windows.length === 0) {
    writeSnapshotAtomically(SNAPSHOT_PATH, {
      provider: 'codex',
      generatedAt: new Date().toISOString(),
      source: { script: SCRIPT_NAME, type: 'cli' },
      status: 'empty',
      staleAfterSeconds: 300,
      approximation: true,
      message: 'codex reported no rate-limit windows',
    });
    return;
  }

  writeSnapshotAtomically(SNAPSHOT_PATH, {
    provider: 'codex',
    generatedAt: new Date().toISOString(),
    source: {
      script: SCRIPT_NAME,
      type: 'cli',
      detail: result.snapshot.planType ? `plan: ${result.snapshot.planType}` : undefined,
    },
    status: 'ok',
    staleAfterSeconds: 300,
    approximation: true,
    windows,
  });
}

void run();
