import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { resetCache } from '../src/server/collectors/cache.js';
import type { FastifyInstance } from 'fastify';
import type { GeneratedUsageSnapshot } from '../src/server/snapshot/types.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../src/server/snapshot/process-runner.js', () => ({
  runScript: vi.fn(),
  CODEX_REFRESH_TIMEOUT_MS: 15_000,
  CLAUDE_REFRESH_TIMEOUT_MS: 30_000,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { runScript } from '../src/server/snapshot/process-runner.js';
import { readFileSync } from 'fs';
const mockRun = vi.mocked(runScript);
const mockReadFileSync = vi.mocked(readFileSync);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validCodexSnapshot(overrides: Partial<GeneratedUsageSnapshot> = {}): GeneratedUsageSnapshot {
  return {
    provider: 'codex',
    generatedAt: new Date().toISOString(),
    source: { script: 'scripts/generate-codex-usage-snapshot.ts', type: 'cli' },
    status: 'ok',
    staleAfterSeconds: 300,
    approximation: true,
    windows: [{ name: '5h', percentRemaining: 70 }],
    ...overrides,
  };
}

function validClaudeSnapshot(overrides: Partial<GeneratedUsageSnapshot> = {}): GeneratedUsageSnapshot {
  return {
    provider: 'claude',
    generatedAt: new Date().toISOString(),
    source: { script: 'scripts/generate-claude-usage-snapshot.ts', type: 'manual' },
    status: 'partial',
    staleAfterSeconds: 3600,
    approximation: true,
    error: { code: 'MANUAL_REFRESH_REQUIRED', message: 'Manual refresh required' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /api/usage/codex/refresh
// ---------------------------------------------------------------------------

describe('POST /api/usage/codex/refresh', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCache();
  });

  afterEach(async () => {
    await app?.close();
    resetCache();
  });

  it('invokes the codex script and returns snapshot metadata on success', async () => {
    mockRun.mockResolvedValueOnce({ ok: true });
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(validCodexSnapshot()));

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ provider: string; status: string; generatedAt: string; snapshotLocation: string }>();
    expect(body.provider).toBe('codex');
    expect(body.status).toBe('ok');
    expect(body.generatedAt).toBeTruthy();
    expect(body.snapshotLocation).toBe('data/usage-snapshots/codex.json');
  });

  it('returns SNAPSHOT_READ_FAILED when script succeeds but snapshot is unreadable', async () => {
    mockRun.mockResolvedValueOnce({ ok: true });
    mockReadFileSync.mockReturnValueOnce('');

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });

    const body = res.json<{ status: string; error: { code: string } }>();
    expect(body.status).toBe('error');
    expect(body.error.code).toBe('SNAPSHOT_READ_FAILED');
  });

  it('returns error when script fails with TIMEOUT', async () => {
    mockRun.mockResolvedValueOnce({ ok: false, code: 'TIMEOUT', message: 'Script exceeded time limit' });

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });

    const body = res.json<{ status: string; error: { code: string; message: string } }>();
    expect(body.status).toBe('error');
    expect(body.error.code).toBe('TIMEOUT');
  });

  it('returns error when script fails with CLI_UNAVAILABLE', async () => {
    mockRun.mockResolvedValueOnce({ ok: false, code: 'CLI_UNAVAILABLE', message: 'Script binary not found' });

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });

    const body = res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('CLI_UNAVAILABLE');
  });

  it('is accessible via POST only (not GET)', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/usage/codex/refresh' });
    expect(res.statusCode).toBe(404);
  });

  it('does not expose raw CLI stdout or stderr in the response', async () => {
    mockRun.mockResolvedValueOnce({ ok: false, code: 'NON_ZERO_EXIT', message: 'Script exited with non-zero code' });

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });
    const raw = res.body;

    expect(raw).not.toMatch(/stdout/);
    expect(raw).not.toMatch(/stderr/);
    expect(raw).not.toMatch(/process\.env/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/usage/claude/refresh
// ---------------------------------------------------------------------------

describe('POST /api/usage/claude/refresh', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCache();
  });

  afterEach(async () => {
    await app?.close();
    resetCache();
  });

  it('invokes the claude script and returns snapshot metadata on success', async () => {
    mockRun.mockResolvedValueOnce({ ok: true });
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(validClaudeSnapshot()));

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/claude/refresh' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ provider: string; status: string; error: { code: string } | null }>();
    expect(body.provider).toBe('claude');
    expect(body.status).toBe('partial');
  });

  it('returns structured manual/unsupported state', async () => {
    mockRun.mockResolvedValueOnce({ ok: true });
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(validClaudeSnapshot()));

    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/usage/claude/refresh' });
    const body = res.json<{ error: { code: string } | null }>();
    expect(body.error?.code).toBe('MANUAL_REFRESH_REQUIRED');
  });

  it('is accessible via POST only', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/usage/claude/refresh' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/usage with generated snapshots
// ---------------------------------------------------------------------------

describe('GET /api/usage with generated snapshots', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    resetCache();
  });

  afterEach(async () => {
    await app?.close();
    resetCache();
  });

  it('serves generated codex snapshot when present and valid', async () => {
    const generatedCodex = validCodexSnapshot({ windows: [{ name: '5h', percentRemaining: 55 }] });
    const generatedClaude = validClaudeSnapshot();

    // cache.ts reads: usage-snapshots/codex.json, then usage-snapshots/claude.json
    mockReadFileSync
      .mockReturnValueOnce(JSON.stringify(generatedCodex))
      .mockReturnValueOnce(JSON.stringify(generatedClaude));

    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/usage' });

    expect(res.statusCode).toBe(200);
    const snaps = res.json<Array<{ provider: string; windows: Array<{ name: string; percentRemaining?: number }> }>>();
    const codex = snaps.find((s) => s.provider === 'codex');
    expect(codex?.windows[0]?.percentRemaining).toBe(55);
  });

  it('falls back to legacy snapshot when generated snapshot is absent', async () => {
    // Read order: generated-codex → legacy-codex → generated-claude
    mockReadFileSync
      .mockImplementationOnce(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }) // generated codex missing
      .mockReturnValueOnce(JSON.stringify({
        provider: 'codex',
        source: 'codex-cli-status-text',
        updatedAt: new Date().toISOString(),
        windows: [{ name: '5h', percentRemaining: 82 }],
      })) // legacy codex snapshot
      .mockImplementationOnce(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }); // generated claude missing

    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/usage' });

    expect(res.statusCode).toBe(200);
    const snaps = res.json<Array<{ provider: string; windows: Array<{ percentRemaining?: number }> }>>();
    const codex = snaps.find((s) => s.provider === 'codex');
    expect(codex?.windows[0]?.percentRemaining).toBe(82);
  });
});
