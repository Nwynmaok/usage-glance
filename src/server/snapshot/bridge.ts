import type { GeneratedUsageSnapshot, GeneratedSnapshotWindow } from './types.js';
import type { ProviderUsageSnapshot, UsageWindowSnapshot } from '../types/usage.js';

function bridgeWindows(windows: GeneratedSnapshotWindow[] | undefined): UsageWindowSnapshot[] {
  if (!windows) return [];
  return windows.map((w) => {
    const out: UsageWindowSnapshot = { name: w.name };
    if (w.percentRemaining !== undefined) out.percentRemaining = w.percentRemaining;
    if (w.resetsAt) out.resetAt = w.resetsAt;
    return out;
  });
}

function stateFromPercents(windows: UsageWindowSnapshot[]): ProviderUsageSnapshot['state'] {
  const percents = windows
    .map((w) => w.percentRemaining)
    .filter((p): p is number => p !== undefined);
  if (percents.length === 0) return 'unknown';
  const min = Math.min(...percents);
  if (min < 10) return 'critical';
  if (min < 25) return 'warn';
  return 'ok';
}

function stateFromSnapshot(snap: GeneratedUsageSnapshot, windows: UsageWindowSnapshot[]): ProviderUsageSnapshot['state'] {
  if (snap.status === 'error') return 'unavailable';
  if (snap.status === 'empty') return 'unknown';
  if (snap.status === 'partial') {
    const code = snap.error?.code;
    if (code === 'MANUAL_REFRESH_REQUIRED' || code === 'UNSUPPORTED_AUTOMATION') return 'manual';
    return 'warn';
  }
  return stateFromPercents(windows);
}

export function bridgeGeneratedSnapshot(snap: GeneratedUsageSnapshot): ProviderUsageSnapshot {
  const windows = bridgeWindows(snap.windows);
  const staleAfterMs = snap.staleAfterSeconds * 1000;
  const stale = Date.now() - new Date(snap.generatedAt).getTime() > staleAfterMs;
  const state = stale ? 'unknown' : stateFromSnapshot(snap, windows);

  const sourceKind: ProviderUsageSnapshot['source']['kind'] =
    snap.source.type === 'api' ? 'provider-api'
    : snap.source.type === 'local-state' ? 'local-json-snapshot'
    : snap.source.type === 'cli' ? 'codex-cli-status-text'
    : snap.source.type === 'manual' ? 'manual-dashboard-only'
    : 'unavailable';

  const confidence: ProviderUsageSnapshot['source']['confidence'] =
    snap.source.type === 'manual' || snap.source.type === 'unsupported' ? 'manual' : 'user-visible-cli';

  const sourceLabel =
    snap.source.type === 'api' ? 'Provider usage API'
    : snap.source.type === 'cli' ? 'Live local CLI-derived'
    : snap.source.type === 'local-state' ? 'Local snapshot'
    : snap.source.type === 'manual' ? 'Manual/dashboard-only'
    : 'Unavailable';

  const caveat =
    snap.source.type === 'api'
      ? 'Provider-reported via undocumented endpoint'
      : 'Not provider-authoritative API data';

  return {
    provider: snap.provider,
    state,
    source: {
      kind: sourceKind,
      label: sourceLabel,
      confidence,
      caveat,
    },
    windows,
    updatedAt: snap.generatedAt,
    stale,
    message: snap.message ?? snap.error?.message,
  };
}
