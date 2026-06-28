import { writeFileSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type { GeneratedUsageSnapshot } from './types.js';

export function writeSnapshotAtomically(snapshotPath: string, snapshot: GeneratedUsageSnapshot): void {
  const dir = dirname(snapshotPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${randomUUID()}.json`);
  try {
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    renameSync(tmpPath, snapshotPath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}
