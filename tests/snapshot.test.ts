import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { EventEmitter } from 'events';

import { validateGeneratedSnapshot, readGeneratedSnapshot } from '../src/server/snapshot/reader.js';
import { writeSnapshotAtomically } from '../src/server/snapshot/atomic-writer.js';
import { runScript, CODEX_REFRESH_TIMEOUT_MS, CLAUDE_REFRESH_TIMEOUT_MS } from '../src/server/snapshot/process-runner.js';
import { renderCard, renderRefreshSection, sanitizeRefreshError } from '../src/client/main.js';
import type { ProviderUsageSnapshot } from '../src/client/main.js';
import type { GeneratedUsageSnapshot } from '../src/server/snapshot/types.js';

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
    windows: [
      { name: '5h', percentRemaining: 70 },
      { name: 'weekly', percentRemaining: 45 },
    ],
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
    message: 'Check usage manually',
    error: { code: 'MANUAL_REFRESH_REQUIRED', message: 'Manual refresh required' },
    ...overrides,
  };
}

function fakeProviderSnapshot(overrides: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    provider: 'codex',
    state: 'ok',
    source: {
      kind: 'codex-cli-status-text',
      label: 'Live local CLI-derived',
      confidence: 'user-visible-cli',
      caveat: 'Not provider-authoritative API data',
    },
    windows: [{ name: '5h', percentRemaining: 70 }],
    updatedAt: new Date().toISOString(),
    stale: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Snapshot schema validation
// ---------------------------------------------------------------------------

describe('Snapshot schema: validateGeneratedSnapshot', () => {
  it('accepts a valid Codex snapshot', () => {
    expect(validateGeneratedSnapshot(validCodexSnapshot())).toBe(true);
  });

  it('accepts a valid Claude snapshot', () => {
    expect(validateGeneratedSnapshot(validClaudeSnapshot())).toBe(true);
  });

  it('rejects missing provider', () => {
    const snap = { ...validCodexSnapshot(), provider: undefined };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects invalid provider value', () => {
    const snap = { ...validCodexSnapshot(), provider: 'openai' };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects non-string generatedAt', () => {
    const snap = { ...validCodexSnapshot(), generatedAt: 12345 };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects generatedAt without T (not ISO format)', () => {
    const snap = { ...validCodexSnapshot(), generatedAt: '2026-06-28' };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects invalid generatedAt timestamp', () => {
    const snap = { ...validCodexSnapshot(), generatedAt: 'not-a-date' };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects invalid status value', () => {
    const snap = { ...validCodexSnapshot(), status: 'degraded' as GeneratedUsageSnapshot['status'] };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects missing approximation field', () => {
    const snap = { ...validCodexSnapshot(), approximation: undefined };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects approximation: false', () => {
    const snap = { ...validCodexSnapshot(), approximation: false as true };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects negative staleAfterSeconds', () => {
    const snap = { ...validCodexSnapshot(), staleAfterSeconds: -1 };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects non-object source', () => {
    const snap = { ...validCodexSnapshot(), source: 'cli' };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects invalid source.type value', () => {
    const snap: GeneratedUsageSnapshot = {
      ...validCodexSnapshot(),
      source: { script: 'x.ts', type: 'unknown' as GeneratedUsageSnapshot['source']['type'] },
    };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects windows with non-string name', () => {
    const snap = { ...validCodexSnapshot(), windows: [{ name: 123 }] };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('rejects windows that is not an array', () => {
    const snap = { ...validCodexSnapshot(), windows: 'bad' };
    expect(validateGeneratedSnapshot(snap)).toBe(false);
  });

  it('accepts snapshot with no windows field', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { windows: _, ...snap } = validCodexSnapshot();
    expect(validateGeneratedSnapshot(snap)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Atomic writer
// ---------------------------------------------------------------------------

describe('Atomic writer: writeSnapshotAtomically', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes JSON to a temp file, then renames it to the canonical path', () => {
    const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {});

    const snap = validCodexSnapshot();
    writeSnapshotAtomically('data/usage-snapshots/codex.json', snap);

    expect(mkdirSpy).toHaveBeenCalledWith('data/usage-snapshots', { recursive: true });

    const writtenPath = writeSpy.mock.calls[0]?.[0] as string;
    expect(writtenPath).toMatch(/data\/usage-snapshots\/.tmp-[^/]+\.json$/);

    const [renameSrc, renameDst] = renameSpy.mock.calls[0] as [string, string];
    expect(renameSrc).toBe(writtenPath);
    expect(renameDst).toBe('data/usage-snapshots/codex.json');
  });

  it('writes valid JSON content to the temp file', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {});

    const snap = validCodexSnapshot();
    writeSnapshotAtomically('data/usage-snapshots/codex.json', snap);

    const content = writeSpy.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(content) as GeneratedUsageSnapshot;
    expect(parsed.provider).toBe('codex');
    expect(parsed.approximation).toBe(true);
  });

  it('never leaves partial JSON as canonical: cleans up temp file if rename fails', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('rename failed');
    });
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    expect(() => writeSnapshotAtomically('data/usage-snapshots/codex.json', validCodexSnapshot())).toThrow('rename failed');
    expect(unlinkSpy).toHaveBeenCalled();
    const unlinkedPath = unlinkSpy.mock.calls[0]?.[0] as string;
    expect(unlinkedPath).toMatch(/\.tmp-/);
  });

  it('does not crash if temp file cleanup fails after rename error', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename failed'); });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => { throw new Error('unlink failed'); });

    expect(() => writeSnapshotAtomically('data/usage-snapshots/codex.json', validCodexSnapshot())).toThrow('rename failed');
  });
});

// ---------------------------------------------------------------------------
// Process runner
// ---------------------------------------------------------------------------

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function makeMockChild(): EventEmitter & { kill: ReturnType<typeof vi.fn> } {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  return child;
}

describe('Process runner: runScript', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('maps ENOENT error to CLI_UNAVAILABLE', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultP = runScript(['tsx', 'script.ts'], 5000);
    child.emit('error', Object.assign(new Error('spawn error'), { code: 'ENOENT' }));

    const result = await resultP;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CLI_UNAVAILABLE');
  });

  it('maps non-ENOENT spawn error to NON_ZERO_EXIT', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultP = runScript(['tsx', 'script.ts'], 5000);
    child.emit('error', Object.assign(new Error('spawn error'), { code: 'EPERM' }));

    const result = await resultP;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NON_ZERO_EXIT');
  });

  it('maps non-zero exit to NON_ZERO_EXIT without leaking stdout/stderr', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultP = runScript(['tsx', 'script.ts'], 5000);
    child.emit('close', 1);

    const result = await resultP;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NON_ZERO_EXIT');
      expect(result.message).not.toContain('stdout');
      expect(result.message).not.toContain('stderr');
    }
  });

  it('maps timeout to TIMEOUT and kills the child process', async () => {
    vi.useFakeTimers();
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultP = runScript(['tsx', 'script.ts'], 5000);

    vi.advanceTimersByTime(5001);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    child.emit('close', null);

    const result = await resultP;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMEOUT');
    vi.useRealTimers();
  });

  it('resolves ok:true when script exits 0', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const resultP = runScript(['tsx', 'script.ts'], 5000);
    child.emit('close', 0);

    const result = await resultP;
    expect(result.ok).toBe(true);
  });

  it('exposes the correct default timeouts', () => {
    expect(CODEX_REFRESH_TIMEOUT_MS).toBe(15_000);
    expect(CLAUDE_REFRESH_TIMEOUT_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// readGeneratedSnapshot (reader/parser)
// ---------------------------------------------------------------------------

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import { readFileSync } from 'fs';
const mockReadFileSync = vi.mocked(readFileSync);

describe('readGeneratedSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for empty file content (NO_OUTPUT equivalent)', () => {
    mockReadFileSync.mockReturnValueOnce('');
    expect(readGeneratedSnapshot('data/usage-snapshots/codex.json')).toBeNull();
  });

  it('returns null for malformed JSON (MALFORMED_OUTPUT equivalent)', () => {
    mockReadFileSync.mockReturnValueOnce('{not valid json');
    expect(readGeneratedSnapshot('data/usage-snapshots/codex.json')).toBeNull();
  });

  it('returns null when file is missing (does not crash on ENOENT)', () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(readGeneratedSnapshot('data/usage-snapshots/codex.json')).toBeNull();
  });

  it('returns null when JSON is valid but fails schema validation', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ provider: 'codex', status: 'ok' }));
    expect(readGeneratedSnapshot('data/usage-snapshots/codex.json')).toBeNull();
  });

  it('returns null on permission error without crashing', () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    expect(readGeneratedSnapshot('data/usage-snapshots/codex.json')).toBeNull();
  });

  it('returns a valid snapshot when content is correct', () => {
    mockReadFileSync.mockReturnValueOnce(JSON.stringify(validCodexSnapshot()));
    const result = readGeneratedSnapshot('data/usage-snapshots/codex.json');
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('codex');
  });
});

// ---------------------------------------------------------------------------
// Frontend: renderCard and refresh controls
// ---------------------------------------------------------------------------

describe('Frontend: renderCard with refresh controls', () => {
  it('renders a Refresh button for Codex card in idle state', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap, { state: 'idle' });
    expect(html).toContain('data-provider="codex"');
    expect(html).toContain('Refresh');
    expect(html).toContain('class="refresh-btn"');
  });

  it('renders a Refresh button for Claude card in idle state', () => {
    const snap = fakeProviderSnapshot({ provider: 'claude', state: 'manual' });
    const html = renderCard(snap, { state: 'idle' });
    expect(html).toContain('data-provider="claude"');
    expect(html).toContain('Refresh');
  });

  it('shows loading indicator while refresh is pending', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap, { state: 'loading' });
    expect(html).toContain('Refreshing');
    expect(html).not.toContain('class="refresh-btn"');
  });

  it('shows Updated label on successful refresh', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap, { state: 'success' });
    expect(html).toContain('Updated');
    expect(html).toContain('class="refresh-btn"');
  });

  it('shows actionable error message on timeout', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap, {
      state: 'error',
      errorCode: 'TIMEOUT',
      errorMessage: sanitizeRefreshError('TIMEOUT', 'fallback'),
    });
    expect(html).toContain('Refresh');
    expect(html).toContain('refresh-error');
    expect(html).toContain('Timed out');
  });

  it('shows actionable error message for missing CLI', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap, {
      state: 'error',
      errorCode: 'CLI_UNAVAILABLE',
      errorMessage: sanitizeRefreshError('CLI_UNAVAILABLE', 'fallback'),
    });
    expect(html).toContain('CLI not found');
  });

  it('shows manual refresh instruction for MANUAL_REFRESH_REQUIRED', () => {
    const snap = fakeProviderSnapshot({ provider: 'claude', state: 'manual' });
    const html = renderCard(snap, {
      state: 'error',
      errorCode: 'MANUAL_REFRESH_REQUIRED',
      errorMessage: sanitizeRefreshError('MANUAL_REFRESH_REQUIRED', 'fallback'),
    });
    expect(html.toLowerCase()).toContain('manual');
  });

  it('preserves approximation caveat in rendered card', () => {
    const snap = fakeProviderSnapshot();
    const html = renderCard(snap);
    expect(html).toContain('Not provider-authoritative API data');
  });

  it('shows empty state message when no windows and has message', () => {
    const snap = fakeProviderSnapshot({
      windows: [],
      state: 'manual',
      message: 'Check usage manually.',
    });
    const html = renderCard(snap);
    expect(html).toContain('Check usage manually.');
  });

  it('layout: refresh section and provider attribute present (390px-usable check)', () => {
    const snap = fakeProviderSnapshot({ provider: 'codex' });
    const html = renderCard(snap);
    expect(html).toContain('card-refresh');
    expect(html).toContain('data-provider="codex"');
    expect(html).toContain('usage-card');
  });
});

describe('Frontend: renderRefreshSection', () => {
  it('renders button in idle state', () => {
    const html = renderRefreshSection('codex', { state: 'idle' });
    expect(html).toContain('data-provider="codex"');
    expect(html).toContain('Refresh');
  });

  it('renders loading state without button', () => {
    const html = renderRefreshSection('codex', { state: 'loading' });
    expect(html).toContain('Refreshing');
    expect(html).not.toContain('class="refresh-btn"');
  });

  it('renders error state with button and error message', () => {
    const html = renderRefreshSection('codex', {
      state: 'error',
      errorCode: 'TIMEOUT',
      errorMessage: 'Timed out. Try again.',
    });
    expect(html).toContain('class="refresh-btn"');
    expect(html).toContain('class="refresh-error"');
    expect(html).toContain('Timed out');
  });

  it('renders success state with button and updated label', () => {
    const html = renderRefreshSection('codex', { state: 'success' });
    expect(html).toContain('class="refresh-btn"');
    expect(html).toContain('refresh-ok');
  });
});

describe('sanitizeRefreshError', () => {
  it('maps CLI_UNAVAILABLE to actionable message', () => {
    const msg = sanitizeRefreshError('CLI_UNAVAILABLE', 'fallback');
    expect(msg).toContain('CLI');
    expect(msg).not.toBe('fallback');
  });

  it('maps TIMEOUT to actionable message containing timed out', () => {
    const msg = sanitizeRefreshError('TIMEOUT', 'fallback');
    expect(msg.toLowerCase()).toContain('timed out');
  });

  it('maps MANUAL_REFRESH_REQUIRED to statusLine capture instruction', () => {
    const msg = sanitizeRefreshError('MANUAL_REFRESH_REQUIRED', 'fallback');
    expect(msg.toLowerCase()).toContain('claude code');
    expect(msg).not.toBe('fallback');
  });

  it('maps AUTH_REQUIRED to codex login instruction', () => {
    const msg = sanitizeRefreshError('AUTH_REQUIRED', 'fallback');
    expect(msg.toLowerCase()).toContain('codex:login');
  });

  it('maps UNSUPPORTED_AUTOMATION to actionable message', () => {
    const msg = sanitizeRefreshError('UNSUPPORTED_AUTOMATION', 'fallback');
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('fallback');
  });

  it('falls back to provided message for unknown codes', () => {
    const msg = sanitizeRefreshError('UNKNOWN_CODE', 'some error occurred');
    expect(msg).toBe('some error occurred');
  });
});

// ---------------------------------------------------------------------------
// Snapshot shapes (for script output verification)
// ---------------------------------------------------------------------------

describe('Generated snapshot shapes', () => {
  it('error snapshot for CLI_UNAVAILABLE is schema-valid', () => {
    const snap: GeneratedUsageSnapshot = {
      provider: 'codex',
      generatedAt: new Date().toISOString(),
      source: { script: 'scripts/generate-codex-usage-snapshot.ts', type: 'cli' },
      status: 'error',
      staleAfterSeconds: 300,
      approximation: true,
      error: { code: 'CLI_UNAVAILABLE', message: 'codex CLI not available' },
    };
    expect(validateGeneratedSnapshot(snap)).toBe(true);
  });

  it('empty snapshot is schema-valid', () => {
    const snap: GeneratedUsageSnapshot = {
      provider: 'codex',
      generatedAt: new Date().toISOString(),
      source: { script: 'scripts/generate-codex-usage-snapshot.ts', type: 'cli' },
      status: 'empty',
      staleAfterSeconds: 300,
      approximation: true,
      message: 'No usage windows found',
    };
    expect(validateGeneratedSnapshot(snap)).toBe(true);
  });

  it('ok snapshot with windows is schema-valid', () => {
    const snap: GeneratedUsageSnapshot = {
      provider: 'codex',
      generatedAt: new Date().toISOString(),
      source: { script: 'scripts/generate-codex-usage-snapshot.ts', type: 'cli' },
      status: 'ok',
      staleAfterSeconds: 300,
      approximation: true,
      windows: [{ name: '5h', percentRemaining: 70 }, { name: 'weekly', percentRemaining: 45 }],
    };
    expect(validateGeneratedSnapshot(snap)).toBe(true);
  });

  it('claude MANUAL_REFRESH_REQUIRED snapshot is schema-valid', () => {
    const snap: GeneratedUsageSnapshot = {
      provider: 'claude',
      generatedAt: new Date().toISOString(),
      source: { script: 'scripts/generate-claude-usage-snapshot.ts', type: 'manual' },
      status: 'partial',
      staleAfterSeconds: 3600,
      approximation: true,
      error: { code: 'MANUAL_REFRESH_REQUIRED', message: 'Manual refresh required' },
    };
    expect(validateGeneratedSnapshot(snap)).toBe(true);
  });
});
