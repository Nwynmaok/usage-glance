import type { ProviderUsageSnapshot } from '../types/usage.js';
import { readCodexSnapshot, defaultCodexSnapshotPath } from './codex.js';
import { getClaudeSnapshot } from './claude.js';
import { readGeneratedSnapshot, defaultGeneratedSnapshotPath } from '../snapshot/reader.js';
import { bridgeGeneratedSnapshot } from '../snapshot/bridge.js';

const POLL_INTERVAL_MS = 60_000;

interface CacheEntry {
  snapshots: ProviderUsageSnapshot[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;

function resolveCodexSnapshot(): ProviderUsageSnapshot {
  const generated = readGeneratedSnapshot(defaultGeneratedSnapshotPath('codex'));
  if (generated) return bridgeGeneratedSnapshot(generated);
  return readCodexSnapshot(defaultCodexSnapshotPath());
}

function resolveClaudeSnapshot(): ProviderUsageSnapshot {
  const generated = readGeneratedSnapshot(defaultGeneratedSnapshotPath('claude'));
  if (generated) return bridgeGeneratedSnapshot(generated);
  return getClaudeSnapshot();
}

export function getUsageSnapshots(): ProviderUsageSnapshot[] {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < POLL_INTERVAL_MS) {
    return cache.snapshots;
  }
  const snapshots = [resolveCodexSnapshot(), resolveClaudeSnapshot()];
  cache = { snapshots, fetchedAt: now };
  return snapshots;
}

export function resetCache(): void {
  cache = null;
}

export function getCacheAge(): number | null {
  return cache ? Date.now() - cache.fetchedAt : null;
}
