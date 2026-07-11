import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'stream';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from 'child_process';
import { readCodexRateLimits } from '../src/server/snapshot/codex-app-server.js';

const mockSpawn = vi.mocked(spawn);

/** A raw JSON-RPC error message fixture that must never reach persisted/API state. */
const RAW_AUTH_ERROR = 'authentication required: token expired for user secret-user-id-12345';
const RAW_OTHER_ERROR = 'internal panic: /Users/someone/.codex/session-abc123.db is locked';

function makeMockChild(handleRequest: (msg: { id?: number; method?: string }) => void) {
  const stdout = new PassThrough();
  const writes: string[] = [];
  const stdin = {
    write: (data: string) => {
      writes.push(data);
      const msg = JSON.parse(data) as { id?: number; method?: string };
      handleRequest(msg);
      return true;
    },
  };
  const child = {
    stdin,
    stdout,
    kill: vi.fn(),
    on: vi.fn(),
  };
  return { child, stdout, writes };
}

describe('readCodexRateLimits: error sanitization', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('does not expose raw app-server error text for auth failures', async () => {
    const { child, stdout } = makeMockChild((msg) => {
      if (msg.method === 'initialize') {
        stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\n');
      } else if (msg.method === 'account/rateLimits/read') {
        stdout.write(
          JSON.stringify({ id: msg.id, error: { code: -1, message: RAW_AUTH_ERROR } }) + '\n',
        );
      }
    });
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const result = await readCodexRateLimits();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AUTH_REQUIRED');
      expect(result.message).not.toContain(RAW_AUTH_ERROR);
      expect(result.message).not.toContain('secret-user-id-12345');
    }
  });

  it('does not expose raw app-server error text for non-auth failures', async () => {
    const { child, stdout } = makeMockChild((msg) => {
      if (msg.method === 'initialize') {
        stdout.write(JSON.stringify({ id: msg.id, result: {} }) + '\n');
      } else if (msg.method === 'account/rateLimits/read') {
        stdout.write(
          JSON.stringify({ id: msg.id, error: { code: -32000, message: RAW_OTHER_ERROR } }) + '\n',
        );
      }
    });
    mockSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const result = await readCodexRateLimits();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NON_ZERO_EXIT');
      expect(result.message).not.toContain(RAW_OTHER_ERROR);
      expect(result.message).not.toContain('session-abc123.db');
    }
  });
});
