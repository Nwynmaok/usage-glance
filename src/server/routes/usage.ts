import type { FastifyInstance } from 'fastify';
import { resolve } from 'path';
import { getUsageSnapshots, resetCache } from '../collectors/cache.js';
import { runScript, CODEX_REFRESH_TIMEOUT_MS, CLAUDE_REFRESH_TIMEOUT_MS } from '../snapshot/process-runner.js';
import { readGeneratedSnapshot, defaultGeneratedSnapshotPath } from '../snapshot/reader.js';

/**
 * The one failure the refresh route itself originates (script exited 0 but the
 * snapshot it should have written is unreadable). Exported so the sanitizer
 * fallback-boundary test enumerates it alongside the snapshot-source modules.
 */
export const SNAPSHOT_READ_FAILED_ERROR = {
  code: 'SNAPSHOT_READ_FAILED' as const,
  message: 'Generated snapshot could not be read after script completed',
};

function scriptArgs(scriptRelPath: string): string[] {
  const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
  const script = resolve(process.cwd(), scriptRelPath);
  return [tsx, script];
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/usage', async () => {
    return getUsageSnapshots();
  });

  app.post('/api/usage/codex/refresh', async (_, reply) => {
    const result = await runScript(
      scriptArgs('scripts/generate-codex-usage-snapshot.ts'),
      CODEX_REFRESH_TIMEOUT_MS,
    );
    if (!result.ok) {
      return reply.status(200).send({
        provider: 'codex',
        status: 'error',
        generatedAt: null,
        staleAfterSeconds: null,
        snapshotLocation: null,
        error: { code: result.code, message: result.message },
      });
    }
    const snapshot = readGeneratedSnapshot(defaultGeneratedSnapshotPath('codex'));
    if (!snapshot) {
      return reply.status(200).send({
        provider: 'codex',
        status: 'error',
        generatedAt: null,
        staleAfterSeconds: null,
        snapshotLocation: null,
        error: { code: SNAPSHOT_READ_FAILED_ERROR.code, message: SNAPSHOT_READ_FAILED_ERROR.message },
      });
    }
    resetCache();
    return reply.status(200).send({
      provider: snapshot.provider,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      staleAfterSeconds: snapshot.staleAfterSeconds,
      snapshotLocation: 'data/usage-snapshots/codex.json',
      error: snapshot.error ?? null,
    });
  });

  app.post('/api/usage/claude/refresh', async (_, reply) => {
    const result = await runScript(
      scriptArgs('scripts/generate-claude-usage-snapshot.ts'),
      CLAUDE_REFRESH_TIMEOUT_MS,
    );
    if (!result.ok) {
      return reply.status(200).send({
        provider: 'claude',
        status: 'error',
        generatedAt: null,
        staleAfterSeconds: null,
        snapshotLocation: null,
        error: { code: result.code, message: result.message },
      });
    }
    const snapshot = readGeneratedSnapshot(defaultGeneratedSnapshotPath('claude'));
    if (!snapshot) {
      return reply.status(200).send({
        provider: 'claude',
        status: 'error',
        generatedAt: null,
        staleAfterSeconds: null,
        snapshotLocation: null,
        error: { code: SNAPSHOT_READ_FAILED_ERROR.code, message: SNAPSHOT_READ_FAILED_ERROR.message },
      });
    }
    resetCache();
    return reply.status(200).send({
      provider: snapshot.provider,
      status: snapshot.status,
      generatedAt: snapshot.generatedAt,
      staleAfterSeconds: snapshot.staleAfterSeconds,
      snapshotLocation: 'data/usage-snapshots/claude.json',
      error: snapshot.error ?? null,
    });
  });
}
