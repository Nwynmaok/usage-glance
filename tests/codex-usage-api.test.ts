import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchCodexUsageFromApi, parseCodexUsageResponse, type CodexAuth } from '../src/server/snapshot/codex-usage-api.js';

const VALID_AUTH: CodexAuth = { accessToken: 'chatgpt-test-token', accountId: 'user-test-account' };

/** Trimmed from a real wham/usage response. */
const USAGE_BODY = {
  user_id: 'user-test-account',
  account_id: 'user-test-account',
  plan_type: 'prolite',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 12.5,
      limit_window_seconds: 604800,
      reset_after_seconds: 554458,
      reset_at: 1784783021,
    },
    secondary_window: null,
  },
  additional_rate_limits: [],
};

const RAW_ERROR_BODY = '{"detail":"token expired for account user-secret-999"}';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCodexUsageResponse', () => {
  it('maps wham windows onto the app-server RateLimitSnapshot shape', () => {
    const snapshot = parseCodexUsageResponse(USAGE_BODY);
    expect(snapshot).toEqual({
      primary: { usedPercent: 12.5, resetsAt: 1784783021, windowDurationMins: 10080 },
      secondary: null,
      planType: 'prolite',
    });
  });

  it('returns null when rate_limit is missing', () => {
    expect(parseCodexUsageResponse({ plan_type: 'plus' })).toBeNull();
    expect(parseCodexUsageResponse(null)).toBeNull();
  });
});

describe('fetchCodexUsageFromApi', () => {
  it('returns AUTH_REQUIRED without a network call when auth.json is missing a token', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchCodexUsageFromApi(1000, null);

    expect(result).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends bearer token and account id header', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(USAGE_BODY));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchCodexUsageFromApi(1000, VALID_AUTH);

    expect(result.ok).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://chatgpt.com/backend-api/wham/usage');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${VALID_AUTH.accessToken}`);
    expect(headers['chatgpt-account-id']).toBe('user-test-account');
  });

  it('parses a successful response into a snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(USAGE_BODY)));

    const result = await fetchCodexUsageFromApi(1000, VALID_AUTH);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.primary?.usedPercent).toBe(12.5);
      expect(result.snapshot.primary?.windowDurationMins).toBe(10080);
      expect(result.snapshot.planType).toBe('prolite');
    }
  });

  it('maps 401 to AUTH_REQUIRED without exposing the response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RAW_ERROR_BODY, 401)));

    const result = await fetchCodexUsageFromApi(1000, VALID_AUTH);

    expect(result).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    if (!result.ok) {
      expect(result.message).not.toContain('user-secret-999');
    }
  });

  it('maps other HTTP failures to HTTP_ERROR with status code only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(RAW_ERROR_BODY, 500)));

    const result = await fetchCodexUsageFromApi(1000, VALID_AUTH);

    expect(result).toMatchObject({ ok: false, code: 'HTTP_ERROR' });
    if (!result.ok) {
      expect(result.message).toContain('500');
      expect(result.message).not.toContain('user-secret-999');
    }
  });

  it('maps a body without rate_limit to MALFORMED_OUTPUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ plan_type: 'plus' })));

    const result = await fetchCodexUsageFromApi(1000, VALID_AUTH);

    expect(result).toMatchObject({ ok: false, code: 'MALFORMED_OUTPUT' });
  });

  it('maps network failure to HTTP_ERROR and timeout to TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await fetchCodexUsageFromApi(1000, VALID_AUTH)).toMatchObject({ ok: false, code: 'HTTP_ERROR' });

    const timeoutErr = new Error('aborted');
    timeoutErr.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeoutErr));
    expect(await fetchCodexUsageFromApi(1000, VALID_AUTH)).toMatchObject({ ok: false, code: 'TIMEOUT' });
  });
});
