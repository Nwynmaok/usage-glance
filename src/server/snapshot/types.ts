export type SnapshotErrorCode =
  | 'CLI_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NON_ZERO_EXIT'
  | 'NO_OUTPUT'
  | 'MALFORMED_OUTPUT'
  | 'SNAPSHOT_READ_FAILED'
  | 'SNAPSHOT_WRITE_FAILED'
  | 'PERMISSION_DENIED'
  | 'MANUAL_REFRESH_REQUIRED'
  | 'UNSUPPORTED_AUTOMATION'
  | 'AUTH_REQUIRED';

export type GeneratedSnapshotStatus = 'ok' | 'empty' | 'partial' | 'error';
export type GeneratedSnapshotSourceType = 'local-state' | 'cli' | 'manual' | 'unsupported';

export interface GeneratedSnapshotWindow {
  name: string;
  resetsAt?: string;
  used?: number;
  limit?: number;
  remaining?: number;
  percentRemaining?: number;
  unit?: 'tokens' | 'requests' | 'percent' | 'unknown';
}

export interface GeneratedUsageSnapshot {
  provider: 'codex' | 'claude';
  generatedAt: string;
  source: {
    script: string;
    type: GeneratedSnapshotSourceType;
    detail?: string;
  };
  status: GeneratedSnapshotStatus;
  staleAfterSeconds: number;
  windows?: GeneratedSnapshotWindow[];
  approximation: true;
  message?: string;
  error?: {
    code: SnapshotErrorCode;
    message: string;
  };
}
