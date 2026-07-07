import { readFileSync } from 'fs';
import type { ProviderUsageSnapshot, UsageWindowSnapshot } from '../types/usage.js';

const STALE_MS = 5 * 60 * 1000;
const CAVEAT = 'Not provider-authoritative API data';

function clampPercent(val: unknown): number | undefined {
  if (typeof val !== 'number' || !isFinite(val)) return undefined;
  if (val < 0 || val > 100) return undefined;
  return val;
}

function stateFromWindows(windows: UsageWindowSnapshot[]): ProviderUsageSnapshot['state'] {
  const percents = windows
    .map((w) => w.percentRemaining)
    .filter((p): p is number => p !== undefined);
  if (percents.length === 0) return 'unknown';
  const min = Math.min(...percents);
  if (min < 10) return 'critical';
  if (min < 25) return 'warn';
  return 'ok';
}

export function parseCodexStatusText(text: string): UsageWindowSnapshot[] {
  const windows: UsageWindowSnapshot[] = [];

  const fiveHourMatch = text.match(/5h\s+limit[:\s]+(\d+)%\s+left(?:\s+\(resets\s+([^)]+)\))?/i);
  if (fiveHourMatch) {
    const pct = parseFloat(fiveHourMatch[1]);
    const w: UsageWindowSnapshot = { name: '5h' };
    const clamped = clampPercent(pct);
    if (clamped !== undefined) w.percentRemaining = clamped;
    if (fiveHourMatch[2]) w.resetLabel = fiveHourMatch[2].trim();
    windows.push(w);
  }

  const weeklyMatch = text.match(/weekly\s+limit[:\s]+(\d+)%\s+left(?:\s+\(resets\s+([^)]+)\))?/i);
  if (weeklyMatch) {
    const pct = parseFloat(weeklyMatch[1]);
    const w: UsageWindowSnapshot = { name: 'weekly' };
    const clamped = clampPercent(pct);
    if (clamped !== undefined) w.percentRemaining = clamped;
    if (weeklyMatch[2]) w.resetLabel = weeklyMatch[2].trim();
    windows.push(w);
  }

  return windows;
}

interface RawCodexSnapshot {
  provider?: unknown;
  source?: unknown;
  updatedAt?: unknown;
  windows?: unknown;
  raw?: unknown;
}

function parseRawWindows(rawWindows: unknown): UsageWindowSnapshot[] {
  if (!Array.isArray(rawWindows)) return [];
  const result: UsageWindowSnapshot[] = [];
  for (const item of rawWindows) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec['name'] === 'string' ? rec['name'] : undefined;
    if (!name) continue;
    const w: UsageWindowSnapshot = { name };
    const clamped = clampPercent(rec['percentRemaining']);
    if (clamped !== undefined) w.percentRemaining = clamped;
    if (typeof rec['resetAt'] === 'string') w.resetAt = rec['resetAt'];
    if (typeof rec['resetLabel'] === 'string') w.resetLabel = rec['resetLabel'];
    result.push(w);
  }
  return result;
}

function unavailable(message?: string): ProviderUsageSnapshot {
  return {
    provider: 'codex',
    state: 'unavailable',
    source: {
      kind: 'unavailable',
      label: 'Unavailable',
      confidence: 'unavailable',
      caveat: CAVEAT,
    },
    windows: [],
    stale: false,
    message,
  };
}

export function readCodexSnapshot(snapshotPath: string): ProviderUsageSnapshot {
  let raw: string;
  try {
    raw = readFileSync(snapshotPath, 'utf-8');
  } catch {
    return unavailable('Snapshot file not found');
  }

  let parsed: RawCodexSnapshot;
  try {
    parsed = JSON.parse(raw) as RawCodexSnapshot;
  } catch {
    return unavailable('Malformed JSON snapshot');
  }

  if (parsed.provider !== 'codex') {
    return unavailable('Invalid provider in snapshot');
  }

  const updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined;
  const stale = updatedAt ? Date.now() - new Date(updatedAt).getTime() > STALE_MS : false;

  let windows = parseRawWindows(parsed.windows);

  if (windows.length === 0 && typeof parsed.raw === 'string') {
    windows = parseCodexStatusText(parsed.raw);
  }

  const sourceKind = parsed.source === 'codex-cli-status-text'
    ? 'codex-cli-status-text' as const
    : 'local-json-snapshot' as const;

  return {
    provider: 'codex',
    state: stale ? 'unknown' : stateFromWindows(windows),
    source: {
      kind: sourceKind,
      label: sourceKind === 'codex-cli-status-text' ? 'Live local CLI-derived' : 'Manual local snapshot',
      confidence: 'user-visible-cli',
      caveat: CAVEAT,
    },
    windows,
    updatedAt,
    stale,
  };
}

export function defaultCodexSnapshotPath(): string {
  return process.env['CODEX_SNAPSHOT_PATH'] ?? 'data/provider-usage/codex.json';
}
