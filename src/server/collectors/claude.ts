import type { ProviderUsageSnapshot } from '../types/usage.js';

export function getClaudeSnapshot(): ProviderUsageSnapshot {
  return {
    provider: 'claude',
    state: 'manual',
    source: {
      kind: 'manual-dashboard-only',
      label: 'Manual/dashboard-only',
      confidence: 'manual',
      caveat: 'Not provider-authoritative API data',
    },
    windows: [],
    stale: false,
    message:
      'Check usage manually: Claude Code `/usage`, or Claude.ai Settings > Usage.',
  };
}
