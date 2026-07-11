import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Resolve the path to the codex binary.
 *
 * Resolution order:
 *   1. CODEX_BIN env var (explicit override)
 *   2. openclaw-managed npm project installations under ~/.openclaw/npm/projects
 *   3. bare `codex` (relies on PATH)
 */
export function resolveCodexBin(): string {
  const envBin = process.env['CODEX_BIN'];
  if (envBin && existsSync(envBin)) return envBin;

  const projectsDir = join(homedir(), '.openclaw', 'npm', 'projects');
  try {
    for (const entry of readdirSync(projectsDir)) {
      const base = join(projectsDir, entry, 'node_modules');
      const candidates = [
        join(base, '.bin', 'codex'),
        join(base, '@openclaw', 'codex', 'node_modules', '.bin', 'codex'),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // projects dir absent or unreadable; fall through
  }

  return 'codex';
}

/**
 * The CODEX_HOME usage-glance reads auth + state from. Defaults to ~/.codex,
 * the standard codex home where `codex login` persists auth.json.
 */
export function resolveCodexHome(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}
