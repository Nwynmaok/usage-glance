import { writeSnapshotAtomically } from '../src/server/snapshot/atomic-writer.js';
import type { GeneratedUsageSnapshot } from '../src/server/snapshot/types.js';

const SNAPSHOT_PATH = 'data/usage-snapshots/claude.json';
const SCRIPT_NAME = 'scripts/generate-claude-usage-snapshot.ts';

// Claude Code `/usage` requires an interactive TTY and cannot be run non-interactively.
// This script documents the limitation as a structured manual snapshot.
const snapshot: GeneratedUsageSnapshot = {
  provider: 'claude',
  generatedAt: new Date().toISOString(),
  source: {
    script: SCRIPT_NAME,
    type: 'manual',
    detail: 'Non-interactive Claude Code automation is not supported',
  },
  status: 'partial',
  staleAfterSeconds: 3600,
  approximation: true,
  message: 'Check usage manually: Claude Code `/usage`, or Claude.ai Settings > Usage.',
  error: {
    code: 'MANUAL_REFRESH_REQUIRED',
    message: 'Claude usage requires manual checking. Use Claude Code `/usage` or Claude.ai Settings > Usage.',
  },
};

writeSnapshotAtomically(SNAPSHOT_PATH, snapshot);
