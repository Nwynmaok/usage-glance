import { describe, it, expect } from 'vitest';
import { bridgeGeneratedSnapshot } from '../src/server/snapshot/bridge.js';
import { renderCard } from '../src/client/main.js';
import type { GeneratedUsageSnapshot } from '../src/server/snapshot/types.js';

// ---------------------------------------------------------------------------
// Deploy-readiness for stale usage snapshots.
//
// Reproduces the post-merge observation: /healthz healthy but /api/usage marks
// both provider snapshots stale. Proves that:
//   1. a stale snapshot bridges to an honestly actionable, sanitized message
//      (stale-to-actionable), and the card surfaces it alongside last-known data;
//   2. an explicit refresh that writes a fresh snapshot clears both the stale
//      flag and the generic guidance (stale-to-refreshed);
//   3. no raw provider error text or credential-shaped data leaks in either case.
//
// All timing is injected via `generatedAt` — no wall-clock dependence, no real
// network, no provider processes.
// ---------------------------------------------------------------------------

const RAW_PROVIDER_LEAK_PATTERNS = [
  /stdout/i,
  /stderr/i,
  /process\.env/i,
  /authorization/i,
  /bearer/i,
  /access[_-]?token/i,
  /oauth/i,
  /sk-[a-z0-9]/i,
];

function assertNoLeak(text: string): void {
  for (const pattern of RAW_PROVIDER_LEAK_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

function staleGeneratedSnapshot(overrides: Partial<GeneratedUsageSnapshot> = {}): GeneratedUsageSnapshot {
  return {
    provider: 'codex',
    // 30 minutes old, well past the 300s (5 min) staleAfterSeconds window.
    generatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    source: { script: 'scripts/generate-codex-usage-snapshot.ts', type: 'api', detail: 'ChatGPT usage API' },
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

function freshGeneratedSnapshot(overrides: Partial<GeneratedUsageSnapshot> = {}): GeneratedUsageSnapshot {
  return staleGeneratedSnapshot({ generatedAt: new Date().toISOString(), ...overrides });
}

describe('Stale snapshot bridges to an honestly actionable state', () => {
  it('marks an ok-but-old snapshot stale and attaches sanitized refresh guidance', () => {
    const bridged = bridgeGeneratedSnapshot(staleGeneratedSnapshot());

    expect(bridged.stale).toBe(true);
    expect(bridged.state).toBe('unknown');
    // Last-known windows are preserved so the user still sees prior numbers.
    expect(bridged.windows).toHaveLength(2);
    // ...but now with actionable, provider-agnostic guidance.
    expect(bridged.message).toBeDefined();
    expect(bridged.message).toContain('Refresh');
    expect(bridged.message).toContain('5 min');
    assertNoLeak(bridged.message ?? '');
  });

  it('applies to the Claude card too, covering the both-cards-stale case', () => {
    const bridged = bridgeGeneratedSnapshot(
      staleGeneratedSnapshot({
        provider: 'claude',
        source: { script: 'scripts/generate-claude-usage-snapshot.ts', type: 'local-state' },
      }),
    );

    expect(bridged.provider).toBe('claude');
    expect(bridged.stale).toBe(true);
    expect(bridged.message).toContain('Refresh');
    assertNoLeak(bridged.message ?? '');
  });

  it('keeps an existing sanitized message (e.g. manual guidance) over the generic one when stale', () => {
    const bridged = bridgeGeneratedSnapshot(
      staleGeneratedSnapshot({
        provider: 'claude',
        status: 'partial',
        windows: undefined,
        message: 'No Claude usage captured yet. Use Claude Code once with the usage-glance statusLine enabled.',
        error: { code: 'MANUAL_REFRESH_REQUIRED', message: 'No Claude usage captured yet. Use Claude Code once with the usage-glance statusLine enabled.' },
      }),
    );

    expect(bridged.stale).toBe(true);
    expect(bridged.message).toContain('Claude Code');
    expect(bridged.message).not.toContain('Click Refresh to update, or check the provider directly');
    assertNoLeak(bridged.message ?? '');
  });

  it('never leaks raw provider error text through the stale path', () => {
    // A stale error snapshot: only the stored, sanitized code/message survives.
    const bridged = bridgeGeneratedSnapshot(
      staleGeneratedSnapshot({
        status: 'error',
        windows: undefined,
        error: { code: 'HTTP_ERROR', message: 'Codex usage API returned HTTP 429' },
      }),
    );

    expect(bridged.stale).toBe(true);
    assertNoLeak(bridged.message ?? '');
    assertNoLeak(JSON.stringify(bridged));
  });
});

describe('Stale-to-refreshed transition clears the stale state and guidance', () => {
  it('a freshly written snapshot bridges to a non-stale, guidance-free card', () => {
    const stale = bridgeGeneratedSnapshot(staleGeneratedSnapshot());
    expect(stale.stale).toBe(true);
    expect(stale.message).toContain('Refresh');

    // Explicit refresh writes a snapshot with a current generatedAt.
    const refreshed = bridgeGeneratedSnapshot(freshGeneratedSnapshot());
    expect(refreshed.stale).toBe(false);
    expect(refreshed.state).toBe('ok');
    // Generic stale guidance is gone once fresh.
    expect(refreshed.message).toBeUndefined();
    expect(refreshed.windows).toHaveLength(2);
  });
});

describe('renderCard surfaces stale guidance to the user', () => {
  it('shows both last-known windows and the actionable message when stale', () => {
    const bridged = bridgeGeneratedSnapshot(staleGeneratedSnapshot());
    const html = renderCard(bridged);

    // Stale badge is present...
    expect(html).toContain('stale-badge');
    // ...last-known window numbers are still shown...
    expect(html).toContain('70% left');
    // ...and the actionable guidance is visible alongside them.
    expect(html).toContain('window-msg');
    expect(html).toContain('Refresh to update');
    expect(html).toContain('data-provider="codex"');
    assertNoLeak(html);
  });

  it('does not render the stale message row on a fresh card with windows', () => {
    const bridged = bridgeGeneratedSnapshot(freshGeneratedSnapshot());
    const html = renderCard(bridged);

    expect(html).not.toContain('window-msg');
    expect(html).not.toContain('stale-badge');
    expect(html).toContain('70% left');
  });
});
