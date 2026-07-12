import { readFileSync } from 'fs';
import { writeSnapshotAtomically } from '../src/server/snapshot/atomic-writer.js';
import type { GeneratedUsageSnapshot, GeneratedSnapshotWindow } from '../src/server/snapshot/types.js';

const SNAPSHOT_PATH = 'data/usage-snapshots/claude.json';
const CAPTURE_PATH = process.env['CLAUDE_STATUSLINE_PATH'] ?? 'data/provider-usage/claude-statusline.json';
const SCRIPT_NAME = 'scripts/generate-claude-usage-snapshot.ts';
const STALE_AFTER_SECONDS = 900;

interface CaptureWindow {
  used_percentage?: number;
  resets_at?: number;
}
interface CaptureFile {
  capturedAt?: string;
  rate_limits?: { five_hour?: CaptureWindow; seven_day?: CaptureWindow };
}

function manualSnapshot(message: string): GeneratedUsageSnapshot {
  return {
    provider: 'claude',
    generatedAt: new Date().toISOString(),
    source: { script: SCRIPT_NAME, type: 'local-state', detail: 'Claude Code statusLine capture' },
    status: 'partial',
    staleAfterSeconds: STALE_AFTER_SECONDS,
    approximation: true,
    message,
    error: {
      code: 'MANUAL_REFRESH_REQUIRED',
      message,
    },
  };
}

function toWindow(name: string, w: CaptureWindow | undefined): GeneratedSnapshotWindow | null {
  if (!w || typeof w.used_percentage !== 'number') return null;
  const window: GeneratedSnapshotWindow = {
    name,
    percentRemaining: Math.max(0, Math.min(100, Math.round(100 - w.used_percentage))),
    unit: 'percent',
  };
  if (typeof w.resets_at === 'number') {
    const d = new Date(w.resets_at * 1000);
    if (!isNaN(d.getTime())) window.resetsAt = d.toISOString();
  }
  return window;
}

function run(): void {
  let capture: CaptureFile;
  try {
    capture = JSON.parse(readFileSync(CAPTURE_PATH, 'utf-8')) as CaptureFile;
  } catch {
    writeSnapshotAtomically(
      SNAPSHOT_PATH,
      manualSnapshot('No Claude usage captured yet. Use Claude Code once (rate limits appear after the first response) with the usage-glance statusLine enabled.'),
    );
    return;
  }

  const windows = [
    toWindow('5h', capture.rate_limits?.five_hour),
    toWindow('weekly', capture.rate_limits?.seven_day),
  ].filter((w): w is GeneratedSnapshotWindow => w !== null);

  if (windows.length === 0) {
    writeSnapshotAtomically(
      SNAPSHOT_PATH,
      manualSnapshot('Claude statusLine produced no rate-limit windows yet. Use Claude Code to populate them.'),
    );
    return;
  }

  // Anchor generatedAt to capture time so staleness reflects real Claude Code activity.
  const generatedAt = capture.capturedAt ?? new Date().toISOString();

  writeSnapshotAtomically(SNAPSHOT_PATH, {
    provider: 'claude',
    generatedAt,
    source: { script: SCRIPT_NAME, type: 'local-state', detail: 'Claude Code statusLine capture' },
    status: 'ok',
    staleAfterSeconds: STALE_AFTER_SECONDS,
    approximation: true,
    windows,
  });
}

run();
