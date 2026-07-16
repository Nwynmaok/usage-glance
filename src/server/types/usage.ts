export type ProviderId = 'codex' | 'claude';

export type UsageSourceKind =
  | 'provider-api'
  | 'local-json-snapshot'
  | 'codex-cli-status-text'
  | 'codex-statusline-derived'
  | 'manual-dashboard-only'
  | 'unavailable';

export interface UsageWindowSnapshot {
  name: '5h' | 'weekly' | string;
  percentRemaining?: number;
  resetAt?: string;
  resetLabel?: string;
}

export interface ProviderUsageSnapshot {
  provider: ProviderId;
  state: 'ok' | 'warn' | 'critical' | 'unknown' | 'unavailable' | 'manual';
  source: {
    kind: UsageSourceKind;
    label: string;
    confidence: 'user-visible-cli' | 'manual' | 'unverified' | 'unavailable';
    caveat: string;
  };
  windows: UsageWindowSnapshot[];
  updatedAt?: string;
  stale: boolean;
  message?: string;
}
