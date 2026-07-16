import { readFileSync } from 'fs';
import type { GeneratedUsageSnapshot } from './types.js';

const VALID_STATUSES = new Set(['ok', 'empty', 'partial', 'error']);
const VALID_SOURCE_TYPES = new Set(['api', 'local-state', 'cli', 'manual', 'unsupported']);

export function validateGeneratedSnapshot(data: unknown): data is GeneratedUsageSnapshot {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  if (d['provider'] !== 'codex' && d['provider'] !== 'claude') return false;

  if (typeof d['generatedAt'] !== 'string') return false;
  const ts = new Date(d['generatedAt']);
  if (isNaN(ts.getTime()) || !d['generatedAt'].includes('T')) return false;

  if (!VALID_STATUSES.has(d['status'] as string)) return false;
  if (d['approximation'] !== true) return false;
  if (typeof d['staleAfterSeconds'] !== 'number' || d['staleAfterSeconds'] < 0) return false;

  if (typeof d['source'] !== 'object' || d['source'] === null) return false;
  const src = d['source'] as Record<string, unknown>;
  if (typeof src['script'] !== 'string') return false;
  if (!VALID_SOURCE_TYPES.has(src['type'] as string)) return false;

  if (d['windows'] !== undefined) {
    if (!Array.isArray(d['windows'])) return false;
    for (const w of d['windows']) {
      if (typeof w !== 'object' || w === null) return false;
      if (typeof (w as Record<string, unknown>)['name'] !== 'string') return false;
    }
  }

  return true;
}

export function readGeneratedSnapshot(snapshotPath: string): GeneratedUsageSnapshot | null {
  try {
    const raw = readFileSync(snapshotPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return validateGeneratedSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function defaultGeneratedSnapshotPath(provider: 'codex' | 'claude'): string {
  return `data/usage-snapshots/${provider}.json`;
}
