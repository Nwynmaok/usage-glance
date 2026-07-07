import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { parseCodexStatusText, readCodexSnapshot } from '../src/server/collectors/codex.js';
import { getClaudeSnapshot } from '../src/server/collectors/claude.js';
import { getUsageSnapshots, resetCache } from '../src/server/collectors/cache.js';
import { buildApp } from '../src/server/app.js';
import type { FastifyInstance } from 'fastify';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const mockReadFileSync = vi.mocked(readFileSync);

function fakeSnapshot(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    provider: 'codex',
    source: 'codex-cli-status-text',
    updatedAt: new Date().toISOString(),
    windows: [
      { name: '5h', percentRemaining: 82, resetLabel: '15:18' },
      { name: 'weekly', percentRemaining: 36 },
    ],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCache();
});

afterEach(() => {
  resetCache();
});

// Test 1: Codex JSON snapshot with 5h and weekly windows maps to ProviderUsageSnapshot
describe('Codex JSON snapshot parsing', () => {
  it('maps 5h and weekly windows with source/caveat metadata', () => {
    mockReadFileSync.mockReturnValueOnce(fakeSnapshot());

    const snap = readCodexSnapshot('data/provider-usage/codex.json');

    expect(snap.provider).toBe('codex');
    expect(snap.stale).toBe(false);
    expect(snap.source.caveat).toBe('Not provider-authoritative API data');
    expect(snap.source.label).toBe('Live local CLI-derived');
    expect(snap.windows).toHaveLength(2);

    const fiveHour = snap.windows.find((w) => w.name === '5h');
    expect(fiveHour?.percentRemaining).toBe(82);
    expect(fiveHour?.resetLabel).toBe('15:18');

    const weekly = snap.windows.find((w) => w.name === 'weekly');
    expect(weekly?.percentRemaining).toBe(36);
  });
});

// Test 2: Codex /status text parser handles representative 5h and Weekly limit lines
describe('Codex status text parser', () => {
  it('parses representative 5h and Weekly limit lines', () => {
    const text = '5h limit: 82% left (resets 15:18)\nWeekly limit: 36% left';
    const windows = parseCodexStatusText(text);

    expect(windows).toHaveLength(2);

    const fiveHour = windows.find((w) => w.name === '5h');
    expect(fiveHour?.percentRemaining).toBe(82);
    expect(fiveHour?.resetLabel).toBe('15:18');

    const weekly = windows.find((w) => w.name === 'weekly');
    expect(weekly?.percentRemaining).toBe(36);
  });
});

// Test 3: Codex parser tolerates missing reset time and partial windows
describe('Codex parser partial/missing data tolerance', () => {
  it('returns weekly window when only Weekly limit is present', () => {
    const text = 'Weekly limit: 55% left';
    const windows = parseCodexStatusText(text);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.name).toBe('weekly');
    expect(windows[0]?.percentRemaining).toBe(55);
    expect(windows[0]?.resetLabel).toBeUndefined();
  });

  it('parses 5h without reset time when not provided', () => {
    const text = '5h limit: 70% left';
    const windows = parseCodexStatusText(text);
    expect(windows[0]?.resetLabel).toBeUndefined();
  });
});

// Test 4: Missing snapshot file returns unavailable without throwing
describe('Missing snapshot file', () => {
  it('returns unavailable state without throwing', () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    const snap = readCodexSnapshot('data/provider-usage/codex.json');

    expect(snap.state).toBe('unavailable');
    expect(snap.windows).toHaveLength(0);
    expect(snap.stale).toBe(false);
  });
});

// Test 5: Malformed JSON returns unavailable/degraded without throwing
describe('Malformed JSON snapshot', () => {
  it('returns unavailable without throwing', () => {
    mockReadFileSync.mockReturnValueOnce('{not valid json');

    const snap = readCodexSnapshot('data/provider-usage/codex.json');

    expect(snap.state).toBe('unavailable');
    expect(snap.windows).toHaveLength(0);
  });
});

// Test 6: Stale snapshot is marked stale with valid last-known windows
describe('Stale snapshot', () => {
  it('marks stale when updatedAt is more than 5 minutes ago', () => {
    const staleTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    mockReadFileSync.mockReturnValueOnce(
      fakeSnapshot({ updatedAt: staleTime })
    );

    const snap = readCodexSnapshot('data/provider-usage/codex.json');

    expect(snap.stale).toBe(true);
    expect(snap.windows).toHaveLength(2);
    expect(snap.updatedAt).toBe(staleTime);
  });
});

// Test 7: Invalid percentages are ignored or marked unknown
describe('Invalid percentages', () => {
  it('ignores out-of-range and non-numeric percentRemaining values', () => {
    const raw = JSON.stringify({
      provider: 'codex',
      source: 'local-json-snapshot',
      updatedAt: new Date().toISOString(),
      windows: [
        { name: '5h', percentRemaining: 150 },
        { name: 'weekly', percentRemaining: -5 },
        { name: 'daily', percentRemaining: 'bad' },
      ],
    });
    mockReadFileSync.mockReturnValueOnce(raw);

    const snap = readCodexSnapshot('data/provider-usage/codex.json');

    for (const w of snap.windows) {
      expect(w.percentRemaining).toBeUndefined();
    }
    expect(snap.state).toBe('unknown');
  });
});

// Test 8: Claude adapter returns manual/dashboard-only with no automated percentages
describe('Claude adapter', () => {
  it('returns manual state with no windows and no automated percentages', () => {
    const snap = getClaudeSnapshot();

    expect(snap.provider).toBe('claude');
    expect(snap.state).toBe('manual');
    expect(snap.source.kind).toBe('manual-dashboard-only');
    expect(snap.source.label).toBe('Manual/dashboard-only');
    expect(snap.windows).toHaveLength(0);
    expect(snap.windows.every((w) => w.percentRemaining === undefined)).toBe(true);
  });
});

// Test 9: Polling/cache logic does not read more frequently than once per 60s
describe('Polling/cache behavior', () => {
  it('returns cached result within 60 seconds without re-reading the file', () => {
    mockReadFileSync.mockReturnValue(fakeSnapshot());

    getUsageSnapshots();
    const callsAfterFirst = mockReadFileSync.mock.calls.length;

    getUsageSnapshots();
    getUsageSnapshots();

    expect(mockReadFileSync.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-reads the file after cache expires', () => {
    vi.useFakeTimers();
    mockReadFileSync.mockReturnValue(fakeSnapshot());

    getUsageSnapshots();
    const callsAfterFirst = mockReadFileSync.mock.calls.length;

    vi.advanceTimersByTime(61_000);
    getUsageSnapshots();

    expect(mockReadFileSync.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    vi.useRealTimers();
  });
});

// Test 10: Usage API endpoint and card rendering includes required fields
describe('GET /api/usage endpoint', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns snapshots with source label, stale state, and caveat text', async () => {
    mockReadFileSync.mockReturnValue(fakeSnapshot());

    app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/usage' });

    expect(response.statusCode).toBe(200);

    const snapshots = response.json<Array<{
      provider: string;
      stale: boolean;
      source: { label: string; caveat: string };
      windows: Array<{ name: string; resetLabel?: string }>;
    }>>();

    expect(Array.isArray(snapshots)).toBe(true);

    const codex = snapshots.find((s) => s.provider === 'codex');
    expect(codex).toBeDefined();
    expect(codex?.source.label).toBeTruthy();
    expect(codex?.source.caveat).toBe('Not provider-authoritative API data');
    expect(typeof codex?.stale).toBe('boolean');

    const fiveHour = codex?.windows.find((w) => w.name === '5h');
    expect(fiveHour?.resetLabel).toBe('15:18');

    const claude = snapshots.find((s) => s.provider === 'claude');
    expect(claude?.source.label).toBe('Manual/dashboard-only');
  });
});
