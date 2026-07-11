import { spawnSync } from 'child_process';
import { resolveCodexBin, resolveCodexHome } from '../src/server/snapshot/codex-bin.js';

/**
 * One-time helper: run `codex login` (ChatGPT OAuth) so the app-server has
 * persisted auth in CODEX_HOME. After this, `npm run snapshot:codex` can read
 * rate limits without re-authenticating.
 */
const bin = resolveCodexBin();
const codexHome = resolveCodexHome();

console.log(`Using codex binary: ${bin}`);
console.log(`CODEX_HOME: ${codexHome}`);
console.log('Launching `codex login` — a browser window will open for ChatGPT sign-in.\n');

const result = spawnSync(bin, ['login'], {
  stdio: 'inherit',
  env: { ...process.env, CODEX_HOME: codexHome },
});

if (result.error) {
  console.error(`\nFailed to launch codex: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
