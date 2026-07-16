import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface ClaudeOAuthCredentials {
  accessToken: string;
  /** Epoch milliseconds, or null when the store omits it. */
  expiresAt: number | null;
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function parseCredentials(raw: string): ClaudeOAuthCredentials | null {
  try {
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0) {
      return null;
    }
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    };
  } catch {
    return null;
  }
}

/**
 * Read the Claude Code OAuth credentials the CLI persists after login.
 * macOS Keychain first (where Claude Code stores them), then
 * ~/.claude/.credentials.json. Read-only: never refreshes or rewrites the
 * stored tokens — token rotation stays owned by Claude Code itself.
 */
export function readClaudeOAuthCredentials(): ClaudeOAuthCredentials | null {
  if (process.platform === 'darwin') {
    try {
      const raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const creds = parseCredentials(raw);
      if (creds) return creds;
    } catch {
      // keychain item absent or unreadable; fall through to the file
    }
  }

  try {
    return parseCredentials(readFileSync(join(homedir(), '.claude', '.credentials.json'), 'utf-8'));
  } catch {
    return null;
  }
}
