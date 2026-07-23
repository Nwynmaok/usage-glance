import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';

// The refresh route resolves the snapshot path through reader.js; point it at
// the sandbox so the route and /api/usage serve the snapshot the real
// generator script produced there, while runScript is stubbed so no live
// provider or codex binary is ever touched by the server under test.
vi.mock('../src/server/snapshot/process-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/snapshot/process-runner.js')>();
  return { ...actual, runScript: vi.fn(async () => ({ ok: true as const })) };
});
vi.mock('../src/server/snapshot/reader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/snapshot/reader.js')>();
  const { join: joinPath } = await import('path');
  const { tmpdir: osTmpdir } = await import('os');
  return {
    ...actual,
    defaultGeneratedSnapshotPath: (provider: 'codex' | 'claude') =>
      joinPath(osTmpdir(), 'usage-glance-sanitizer-e2e', 'data', 'usage-snapshots', `${provider}.json`),
  };
});

import { buildApp } from '../src/server/app.js';
import { resetCache } from '../src/server/collectors/cache.js';
import { sanitizeRefreshError, renderRefreshSection } from '../src/client/main.js';
import {
  CODEX_APP_SERVER_ERROR_PAIRS,
  CODEX_APP_SERVER_ERROR_MESSAGES,
} from '../src/server/snapshot/codex-app-server.js';
import {
  CODEX_USAGE_API_ERROR_PAIRS,
  CODEX_USAGE_API_HTTP_ERROR_STATUSES,
  codexUsageApiHttpErrorMessage,
} from '../src/server/snapshot/codex-usage-api.js';
import { PROCESS_RUNNER_ERROR_PAIRS } from '../src/server/snapshot/process-runner.js';
import { SNAPSHOT_READ_FAILED_ERROR } from '../src/server/routes/usage.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SANDBOX = join(tmpdir(), 'usage-glance-sanitizer-e2e');
const SNAPSHOT_FILE = join(SANDBOX, 'data', 'usage-snapshots', 'codex.json');

// Assembled at runtime so no credential-shaped literal is committed to source.
const SECRET = ['synthetic', 'secret', 'do', 'not', 'persist'].join('-');
const CREDENTIAL = `Bearer ${SECRET}`;
const RAW_RPC_ERROR = `internal panic while refreshing session: request sent ${CREDENTIAL} and account token cache /users/someone/.codex/auth.json is locked`;
const RAW_AUTH_RPC_ERROR = `authentication required: ${CREDENTIAL} expired for account synthetic-account-id`;

// Derived from the source module's exported literals so the offline injection
// assertions below cannot drift from the messages production actually emits.
const STABLE_NON_AUTH = { code: 'NON_ZERO_EXIT', message: CODEX_APP_SERVER_ERROR_MESSAGES.returnedError };
const STABLE_AUTH = { code: 'AUTH_REQUIRED', message: CODEX_APP_SERVER_ERROR_MESSAGES.loginRequired };

// A fake `codex app-server` speaking newline-delimited JSON-RPC. The raw error
// text arrives via env var so the fixture is never persisted inside a script.
const FAKE_CODEX_BIN = `#!/usr/bin/env node
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\\n');
  } else if (msg.method === 'account/rateLimits/read') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: process.env.SYNTHETIC_RPC_ERROR } }) + '\\n');
  }
});
`;

/** Run the real generator script offline against the fake app-server. */
function runGenerator(rawError: string): Promise<number | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
      [join(REPO_ROOT, 'scripts', 'generate-codex-usage-snapshot.ts')],
      {
        cwd: SANDBOX,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
          ...process.env,
          CODEX_BIN: join(SANDBOX, 'fake-codex'),
          CODEX_HOME: join(SANDBOX, 'codex-home'), // empty: no auth.json, so the direct usage API path returns AUTH_REQUIRED without any network call
          SYNTHETIC_RPC_ERROR: rawError,
        },
      },
    );
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise(code));
  });
}

let authVariantRawSnapshot = '';
let nonAuthVariantRawSnapshot = '';

beforeAll(async () => {
  rmSync(SANDBOX, { recursive: true, force: true });
  mkdirSync(join(SANDBOX, 'codex-home'), { recursive: true });
  const fakeBin = join(SANDBOX, 'fake-codex');
  writeFileSync(fakeBin, FAKE_CODEX_BIN, 'utf-8');
  chmodSync(fakeBin, 0o755);

  expect(await runGenerator(RAW_AUTH_RPC_ERROR)).toBe(0);
  authVariantRawSnapshot = readFileSync(SNAPSHOT_FILE, 'utf-8');

  // The non-auth variant runs last so the snapshot on disk for the API-surface
  // tests below is the generic app-server failure.
  expect(await runGenerator(RAW_RPC_ERROR)).toBe(0);
  nonAuthVariantRawSnapshot = readFileSync(SNAPSHOT_FILE, 'utf-8');
}, 60_000);

afterAll(() => {
  rmSync(SANDBOX, { recursive: true, force: true });
});

beforeEach(() => {
  resetCache();
});

describe('generated snapshot file (real generator script, offline failure injection)', () => {
  it('persists only the stable code/message for a generic app-server error', () => {
    const snapshot = JSON.parse(nonAuthVariantRawSnapshot) as {
      provider: string;
      status: string;
      error?: { code: string; message: string };
    };
    expect(snapshot.provider).toBe('codex');
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toEqual(STABLE_NON_AUTH);
  });

  it('persists only the stable code/message for an auth error', () => {
    const snapshot = JSON.parse(authVariantRawSnapshot) as {
      status: string;
      error?: { code: string; message: string };
    };
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toEqual(STABLE_AUTH);
  });

  it('never writes the raw JSON-RPC text or credential-shaped substring to disk', () => {
    for (const raw of [nonAuthVariantRawSnapshot, authVariantRawSnapshot]) {
      expect(raw.includes(SECRET)).toBe(false);
      expect(raw.includes(CREDENTIAL)).toBe(false);
      expect(raw.includes('internal panic')).toBe(false);
      expect(raw.includes('synthetic-account-id')).toBe(false);
    }
  });
});

describe('refresh API and /api/usage surfaces', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/usage/codex/refresh returns the stable error and no raw text', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/usage/codex/refresh' });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ provider: string; status: string; error: { code: string; message: string } | null }>();
    expect(body.provider).toBe('codex');
    expect(body.status).toBe('error');
    expect(body.error).toEqual(STABLE_NON_AUTH);
    expect(response.body.includes(SECRET)).toBe(false);
    expect(response.body.includes(CREDENTIAL)).toBe(false);
  });

  it('GET /api/usage bridges the failed snapshot to a stable user-facing state', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/usage' });

    expect(response.statusCode).toBe(200);
    const codex = response
      .json<Array<{ provider: string; state: string; message?: string }>>()
      .find((s) => s.provider === 'codex');
    expect(codex).toBeDefined();
    expect(codex?.state).toBe('unavailable');
    expect(codex?.message).toBe(STABLE_NON_AUTH.message);
    expect(response.body.includes(SECRET)).toBe(false);
    expect(response.body.includes(CREDENTIAL)).toBe(false);
  });
});

describe('UI refresh error state', () => {
  // Every failure the codex refresh path can hand the client is derived directly
  // from the exported mappings in the modules that emit them — codex-usage-api.ts,
  // codex-app-server.ts, process-runner.ts, and the refresh route in usage.ts.
  // Those modules enumerate fixed-literal pairs exhaustively; the sole templated
  // failure — codex-usage-api's HTTP_ERROR family, whose message interpolates only
  // a numeric status — is represented here by CODEX_USAGE_API_ERROR_PAIRS' concrete
  // witnesses (404/418/500/503) and additionally proven as a family below. Consuming
  // the same literals production ships means this proof cannot silently drift when a
  // message is added or changed.
  const serverPairs: ReadonlyArray<{ code: string; message: string }> = [
    ...CODEX_USAGE_API_ERROR_PAIRS,
    ...CODEX_APP_SERVER_ERROR_PAIRS,
    ...PROCESS_RUNNER_ERROR_PAIRS,
    SNAPSHOT_READ_FAILED_ERROR,
  ];

  it('maps every server-originated failure code to non-empty user-safe text without raw content', () => {
    // Sanity-check that the enumeration still covers the two stable messages the
    // offline injection above proves, so an accidental gap surfaces here.
    expect(serverPairs).toContainEqual(STABLE_NON_AUTH);
    expect(serverPairs).toContainEqual(STABLE_AUTH);

    for (const { code, message } of serverPairs) {
      const text = sanitizeRefreshError(code, message);
      expect(text.length).toBeGreaterThan(0);
      expect(text.includes(SECRET)).toBe(false);
      expect(text.includes(CREDENTIAL)).toBe(false);
    }
  });

  it('proves the templated HTTP_ERROR family is sanitizer-safe for every status, including non-500 (418)', () => {
    // codex-usage-api emits codexUsageApiHttpErrorMessage(status) for ANY non-ok,
    // non-401/403 status, so the family is unbounded and cannot be a fixed pair.
    // It is safe because only the numeric status is ever interpolated. Prove that
    // as a family across a spread of statuses (4xx incl. the teapot 418, 5xx, and
    // an arbitrary code well outside the representative witness set).
    const statuses = [...CODEX_USAGE_API_HTTP_ERROR_STATUSES, 400, 429, 502, 599];
    for (const status of statuses) {
      const message = codexUsageApiHttpErrorMessage(status);
      const text = sanitizeRefreshError('HTTP_ERROR', message);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(String(status));
      expect(text.includes(SECRET)).toBe(false);
      expect(text.includes(CREDENTIAL)).toBe(false);
    }

    // Durable coverage for the exact pair QA proved missing: HTTP 418 must be a
    // representable, sanitizer-safe member of the enumerated concrete witnesses.
    const teapot = { code: 'HTTP_ERROR', message: codexUsageApiHttpErrorMessage(418) };
    expect(serverPairs).toContainEqual(teapot);
    expect(sanitizeRefreshError(teapot.code, teapot.message)).toContain('418');
  });

  it('renders the refresh error section from the API payload without raw content', () => {
    const payloadError = JSON.parse(nonAuthVariantRawSnapshot) as { error: { code: string; message: string } };
    const html = renderRefreshSection('codex', {
      state: 'error',
      errorCode: payloadError.error.code,
      errorMessage: sanitizeRefreshError(payloadError.error.code, payloadError.error.message),
    });

    expect(html).toContain('refresh-error');
    expect(html).toContain(STABLE_NON_AUTH.message);
    expect(html.includes(SECRET)).toBe(false);
    expect(html.includes(CREDENTIAL)).toBe(false);
  });

  it('even a hypothetical unsanitized fallback never receives raw text from the exercised path', () => {
    // sanitizeRefreshError falls back to the server message for unknown codes;
    // `serverPairs` (derived from production's exported mappings) proves every
    // server message on this path is already a stable literal, so the fallback
    // cannot reintroduce provider text.
    expect(sanitizeRefreshError(STABLE_NON_AUTH.code, STABLE_NON_AUTH.message)).toBe(STABLE_NON_AUTH.message);
    expect(sanitizeRefreshError(STABLE_AUTH.code, STABLE_AUTH.message)).toBe(
      'Codex not signed in. Run `npm run codex:login` once to authenticate.',
    );
  });
});
