import { homedir } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

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
