import { homedir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, execFileSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const LABEL = "com.nwynmaok.usage-glance";

export const REPO_ROOT = resolve(__dirname, "..");

const HOME = homedir();

export const PLIST_PATH = `${HOME}/Library/LaunchAgents/${LABEL}.plist`;
export const LOG_DIR = `${HOME}/Library/Logs/usage-glance`;
export const STDOUT_PATH = `${LOG_DIR}/stdout.log`;
export const STDERR_PATH = `${LOG_DIR}/stderr.log`;
export const WRAPPER_PATH = `${REPO_ROOT}/scripts/launchd-start.zsh`;

/**
 * @param {{ npmPath: string; port?: number }} opts
 * @returns {string}
 */
export function buildLaunchAgentPlist({ npmPath, port = 3000 }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/bin/zsh</string>
\t\t<string>${WRAPPER_PATH}</string>
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${REPO_ROOT}</string>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${STDOUT_PATH}</string>
\t<key>StandardErrorPath</key>
\t<string>${STDERR_PATH}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PORT</key>
\t\t<string>${port}</string>
\t\t<key>HOST</key>
\t\t<string>127.0.0.1</string>
\t\t<key>USAGE_GLANCE_NPM</key>
\t\t<string>${npmPath}</string>
\t\t<key>PATH</key>
\t\t<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
\t</dict>
</dict>
</plist>
`;
}

/**
 * Builds the launchctl GUI target string for the current user.
 * @returns {string}
 */
export function guiTarget() {
  return `gui/${process.getuid()}`;
}

/**
 * Builds the launchctl service target string.
 * @returns {string}
 */
export function serviceTarget() {
  return `${guiTarget()}/${LABEL}`;
}

/**
 * Resolves an absolute npm binary path.
 * Prefers npm_execpath when it points to npm itself, else falls back to `command -v npm`.
 * @returns {string}
 */
export function resolveNpmPath() {
  const execpath = process.env.npm_execpath;
  if (execpath && !execpath.endsWith("npx") && !execpath.endsWith("npx.js")) {
    return execpath;
  }
  try {
    const result = execSync("command -v npm", { encoding: "utf8" }).trim();
    if (result) return result;
  } catch {
    // fall through
  }
  throw new Error(
    "Cannot resolve npm binary. Ensure npm is on your PATH or run via `npm run service:install`.",
  );
}

/**
 * Returns the Node.js major version used by the given npm binary.
 * @param {string} npmPath
 * @returns {number}
 */
export function resolveNodeMajorVersion(npmPath) {
  const npmDir = dirname(npmPath);
  const nodeBin = `${npmDir}/node`;
  const nodePath = existsSync(nodeBin) ? nodeBin : "node";
  const raw = execFileSync(nodePath, ["--version"], { encoding: "utf8" }).trim();
  // v24.1.0 → 24
  const match = raw.match(/^v?(\d+)/);
  if (!match) throw new Error(`Cannot parse Node version from: ${raw}`);
  return parseInt(match[1], 10);
}

/**
 * Validates that the npm binary's associated Node runtime is >=24.
 * Throws with a clear message if not.
 * @param {string} npmPath
 */
export function assertNodeVersion(npmPath) {
  const major = resolveNodeMajorVersion(npmPath);
  if (major < 24) {
    const nodeVersion = execSync("node --version", { encoding: "utf8" }).trim();
    throw new Error(
      `Node version check failed.\n` +
        `  PROJECT.md requires Node 24. Found Node ${major} (${nodeVersion}).\n` +
        `  npm path: ${npmPath}\n` +
        `  Resolve this before installing or restarting the service.\n` +
        `  Hint: switch to Node 24 via nvm/volta/fnm or install it via Homebrew.`,
    );
  }
}

/**
 * Runs `npm run build` inside REPO_ROOT.
 */
export function runBuild() {
  console.log("Building...");
  execSync("npm run build", { cwd: REPO_ROOT, stdio: "inherit" });
}

function requireDarwin(cmd) {
  if (process.platform !== "darwin") {
    console.error(
      `error: \`${cmd}\` requires macOS (launchd). Current platform: ${process.platform}`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

async function cmdInstall() {
  requireDarwin("install");
  const npmPath = resolveNpmPath();
  assertNodeVersion(npmPath);

  mkdirSync(`${HOME}/Library/LaunchAgents`, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  runBuild();

  const plist = buildLaunchAgentPlist({ npmPath });
  writeFileSync(PLIST_PATH, plist, "utf8");
  console.log(`Wrote plist: ${PLIST_PATH}`);

  // Best-effort bootout (ignore failures if not loaded)
  spawnSync("launchctl", ["bootout", guiTarget(), PLIST_PATH], { stdio: "inherit" });

  execFileSync("launchctl", ["bootstrap", guiTarget(), PLIST_PATH], { stdio: "inherit" });
  execFileSync("launchctl", ["enable", serviceTarget()], { stdio: "inherit" });
  console.log(`Service installed and started: ${LABEL}`);
}

async function cmdStart() {
  requireDarwin("start");
  if (!existsSync(PLIST_PATH)) {
    console.error(`Plist not found: ${PLIST_PATH}`);
    console.error("Run `npm run service:install` first.");
    process.exit(1);
  }
  spawnSync("launchctl", ["bootout", guiTarget(), PLIST_PATH], { stdio: "inherit" });
  execFileSync("launchctl", ["bootstrap", guiTarget(), PLIST_PATH], { stdio: "inherit" });
  execFileSync("launchctl", ["enable", serviceTarget()], { stdio: "inherit" });
  console.log(`Service started: ${LABEL}`);
}

async function cmdRestart() {
  requireDarwin("restart");
  const npmPath = resolveNpmPath();
  assertNodeVersion(npmPath);
  runBuild();
  execFileSync("launchctl", ["kickstart", "-k", serviceTarget()], { stdio: "inherit" });
  console.log(`Service restarted: ${LABEL}`);
}

async function cmdStatus() {
  requireDarwin("status");
  const result = spawnSync("launchctl", ["print", serviceTarget()], { encoding: "utf8" });
  if (result.status === 0) {
    process.stdout.write(result.stdout || "");
  } else {
    process.stderr.write(result.stderr || "");
    console.error(`\nService not loaded or error. Log paths:`);
    console.error(`  stdout: ${STDOUT_PATH}`);
    console.error(`  stderr: ${STDERR_PATH}`);
    if (existsSync(STDERR_PATH)) {
      try {
        const lines = readFileSync(STDERR_PATH, "utf8").trim().split("\n");
        const tail = lines.slice(-10).join("\n");
        console.error(`\nLast stderr lines:\n${tail}`);
      } catch {
        // ignore
      }
    }
    process.exit(result.status ?? 1);
  }
}

async function cmdUninstall() {
  requireDarwin("uninstall");
  if (existsSync(PLIST_PATH)) {
    spawnSync("launchctl", ["bootout", guiTarget(), PLIST_PATH], { stdio: "inherit" });
    unlinkSync(PLIST_PATH);
    console.log(`Removed plist: ${PLIST_PATH}`);
  } else {
    console.log(`Plist not found, nothing to remove: ${PLIST_PATH}`);
  }
  console.log(`Logs preserved at: ${LOG_DIR}`);
  console.log("Run with --purge-logs to also remove logs (not implemented; delete manually).");
}

async function cmdVerify() {
  const port = process.env.PORT || "3000";
  const url = `http://127.0.0.1:${port}/healthz`;
  const results = [];

  // Check macOS / launchctl on Darwin
  if (process.platform === "darwin") {
    const lc = spawnSync("launchctl", ["print", serviceTarget()], { encoding: "utf8" });
    if (lc.status === 0) {
      results.push({ check: "launchd service loaded", pass: true });
    } else {
      results.push({
        check: "launchd service loaded",
        pass: false,
        hint: `Run \`npm run service:status\` or \`npm run service:install\``,
      });
    }
  }

  // Check build artifact
  const distExists = existsSync(`${REPO_ROOT}/dist/server/index.js`);
  results.push({
    check: "dist/server/index.js exists",
    pass: distExists,
    hint: distExists ? undefined : "Run `npm run build`",
  });

  // Check /healthz
  let healthPass = false;
  let healthHint;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      healthHint = `HTTP ${res.status} from ${url}. Check logs at ${STDERR_PATH}`;
    } else {
      const body = await res.json();
      if (body.status !== "ok") {
        healthHint = `status field is ${JSON.stringify(body.status)}, expected "ok"`;
      } else if (typeof body.uptime !== "number") {
        healthHint = `uptime field is ${typeof body.uptime}, expected number`;
      } else {
        healthPass = true;
      }
    }
  } catch (err) {
    healthHint =
      `Cannot reach ${url}: ${err.message}\n` +
      `  Hints:\n` +
      `    - Is the service running? Check \`npm run service:status\`\n` +
      `    - Check logs: ${STDERR_PATH}\n` +
      `    - Port conflict? Run: lsof -iTCP:${port} -sTCP:LISTEN`;
  }
  results.push({ check: `GET ${url} → {status:"ok",uptime:number}`, pass: healthPass, hint: healthHint });

  // Summary
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.check}`);
    if (!r.pass) {
      allPass = false;
      if (r.hint) console.log(`       → ${r.hint}`);
    }
  }
  if (allPass) {
    console.log("\nAll checks passed.");
  } else {
    console.error("\nSome checks failed.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point (only runs when invoked directly as a CLI)
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [, , cmd, ...args] = process.argv;
  const commands = { install: cmdInstall, start: cmdStart, restart: cmdRestart, status: cmdStatus, uninstall: cmdUninstall, verify: cmdVerify };

  if (!cmd || !commands[cmd]) {
    const available = Object.keys(commands).join(" | ");
    console.error(`usage: node scripts/launchd.mjs <command>`);
    console.error(`commands: ${available}`);
    if (cmd) console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }

  commands[cmd](...args).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
