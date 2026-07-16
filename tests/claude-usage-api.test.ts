import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchClaudeUsageFromApi, parseClaudeUsageResponse } from '../src/server/snapshot/claude-usage-api.js';
import type { ClaudeOAuthCredentials } from '../src/server/snapshot/claude-oauth-creds.js';

const VALID_CREDS: ClaudeOAuthCredentials = {
  accessToken: 'sk-ant-oat01-test-token',
  expiresAt: Date.now() + 60 * 60 * 1000,
};

/** Shape documented by community monitors of /api/oauth/usage. */
const USAGE_BODY = {
  five_hour: { utilization: 6.0, resets_at: '2026-07-16T04:59:59.943648+00:00' },
  seven_day: { utilization: 35.0, resets_at: '2026-07-18T03:59:59.943679+00:00' },
  seven_day_oauth_apps: null,
  seven_day_opus: { utilization: 0.0, resets_at: null },
  iguana_necktie: null,
};

const RAW_ERROR_BODY = '{"error":{"message":"secret internal detail user-abc123"}}';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseClaudeUsageResponse', () => {
  it('maps known windows to dashboard names in stable order', () => {
    const windows = parseClaudeUsageResponse(USAGE_BODY);
    expect(windows.map((w) => w.name)).toEqual(['5h', 'weekly', 'weekly-opus']);
    expect(windows[0]).toMatchObject({ percentRemaining: 94, unit: 'percent' });
    expect(windows[0]?.resetsAt).toBe('2026-07-16T04:59:59.943Z');
    expect(windows[1]?.percentRemaining).toBe(65);
    // null resets_at yields a window without resetsAt
    expect(windows[2]).toEqual({ name: 'weekly-opus', percentRemaining: 100, unit: 'percent' });
  });

  it('keeps unknown window keys with dashed names', () => {
    const windows = parseClaudeUsageResponse({
      seven_day: { utilization: 10 },
      some_new_window: { utilization: 50 },
    });
    expect(windows.map((w) => w.name)).toEqual(['weekly', 'some-new-window']);
  });

  it('returns no windows for malformed bodies', () => {
    expect(parseClaudeUsageResponse(null)).toEqual([]);
    expect(parseClaudeUsageResponse('nope')).toEqual([]);
    expect(parseClaudeUsageResponse({ five_hour: { utilization: 'high' } })).toEqual([]);
  });
});

describe('fetchClaudeUsageFromApi', () => {
  it('returns AUTH_REQUIRED without a network call when credentials are missing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchClaudeUsageFromApi(1000, null);

    expect(result).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns AUTH_REQUIRED without a network call when the token is expired', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchClaudeUsageFromApi(1000, {
      accessToken: 'sk-ant-oat01-old',
      expiresAt: Date.now() - 1000,
    });

    expect(result).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends bearer token, oauth beta header, and claude-code User-Agent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(USAGE_BODY));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${VALID_CREDS.accessToken}`);
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
    // Without this UA the endpoint 429s persistently (anthropics/claude-code#31021)
    expect(headers['User-Agent']).toMatch(/^claude-code\//);
  });

  it('parses windows from a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(USAGE_BODY)));

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.windows.map((w) => w.name)).toEqual(['5h', 'weekly', 'weekly-opus']);
    }
  });

  it('maps 401 to AUTH_REQUIRED without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RAW_ERROR_BODY, 401)));

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    if (!result.ok) {
      expect(result.message).not.toContain('user-abc123');
      expect(result.message).not.toContain('secret internal detail');
    }
  });

  it('maps other HTTP failures to HTTP_ERROR with status code only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RAW_ERROR_BODY, 429)));

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result).toMatchObject({ ok: false, code: 'HTTP_ERROR' });
    if (!result.ok) {
      expect(result.message).toContain('429');
      expect(result.message).not.toContain('user-abc123');
    }
  });

  it('maps non-JSON output to MALFORMED_OUTPUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>', { status: 200 })));

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
  });

  it('maps a window-less JSON body to MALFORMED_OUTPUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })));

    const result = await fetchClaudeUsageFromApi(1000, VALID_CREDS);

    expect(result).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
  });

  it('maps network failure to HTTP_ERROR and timeout to TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await fetchClaudeUsageFromApi(1000, VALID_CREDS)).toMatchObject({ ok: false, code: 'HTTP_ERROR' });

    const timeoutErr = new Error('aborted');
    timeoutErr.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));
    expect(await fetchClaudeUsageFromApi(1000, VALID_CREDS)).toMatchObject({ ok: false, code: 'TIMEOUT' });
  });
});
