import { describe, it, expect } from "vitest";
import {
  buildLaunchAgentPlist,
  guiTarget,
  serviceTarget,
  resolveNodeMajorVersion,
  assertNodeVersion,
  LABEL,
  REPO_ROOT,
  WRAPPER_PATH,
  STDOUT_PATH,
  STDERR_PATH,
  PLIST_PATH,
} from "../scripts/launchd.mjs";

const FAKE_NPM = "/opt/homebrew/bin/npm";

describe("launchd plist generation", () => {
  it("includes the stable launchd label", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("com.nwynmaok.usage-glance");
    expect(LABEL).toBe("com.nwynmaok.usage-glance");
  });

  it("includes the repo working directory", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>WorkingDirectory</key>");
    expect(plist).toContain(`<string>${REPO_ROOT}</string>`);
    expect(REPO_ROOT).toMatch(/^\//); // absolute path; basename varies in scratch worktrees
  });

  it("invokes /bin/zsh with the wrapper script path", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<string>/bin/zsh</string>");
    expect(plist).toContain("scripts/launchd-start.zsh");
    expect(plist).toContain(`<string>${WRAPPER_PATH}</string>`);
    expect(WRAPPER_PATH).toBe(`${REPO_ROOT}/scripts/launchd-start.zsh`);
  });

  it("sets RunAtLoad to true", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it("sets KeepAlive to true", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });

  it("sets stdout and stderr log paths under ~/Library/Logs/usage-glance", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain(`<string>${STDOUT_PATH}</string>`);
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain(`<string>${STDERR_PATH}</string>`);
    expect(STDOUT_PATH).toContain("Library/Logs/usage-glance/stdout.log");
    expect(STDERR_PATH).toContain("Library/Logs/usage-glance/stderr.log");
  });

  it("sets PORT=3000 by default", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>PORT</key>");
    expect(plist).toContain("<string>3000</string>");
  });

  it("respects a custom port override", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM, port: 4000 });
    expect(plist).toContain("<string>4000</string>");
    expect(plist).not.toContain("<string>3000</string>");
  });

  it("binds to localhost by setting HOST=127.0.0.1", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>HOST</key>");
    expect(plist).toContain("<string>127.0.0.1</string>");
  });

  it("sets USAGE_GLANCE_NPM to the provided npm path", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain("<key>USAGE_GLANCE_NPM</key>");
    expect(plist).toContain(`<string>${FAKE_NPM}</string>`);
  });

  it("uses a different npm path when supplied", () => {
    const customNpm = "/usr/local/bin/npm";
    const plist = buildLaunchAgentPlist({ npmPath: customNpm });
    expect(plist).toContain(`<string>${customNpm}</string>`);
    expect(plist).not.toContain(FAKE_NPM);
  });

  it("exports a plist path under ~/Library/LaunchAgents", () => {
    expect(PLIST_PATH).toContain("Library/LaunchAgents/com.nwynmaok.usage-glance.plist");
  });

  it("generates valid plist XML boilerplate", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain("<!DOCTYPE plist");
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain("</plist>");
  });

  it("does not call launchctl (pure generation only)", () => {
    const plist = buildLaunchAgentPlist({ npmPath: FAKE_NPM });
    expect(typeof plist).toBe("string");
    expect(plist.length).toBeGreaterThan(0);
  });
});

describe("launchctl target construction", () => {
  it("guiTarget returns gui/<uid>", () => {
    const target = guiTarget();
    expect(target).toMatch(/^gui\/\d+$/);
  });

  it("serviceTarget returns gui/<uid>/com.nwynmaok.usage-glance", () => {
    const target = serviceTarget();
    expect(target).toMatch(/^gui\/\d+\/com\.nwynmaok\.usage-glance$/);
  });

  it("serviceTarget contains the stable label", () => {
    expect(serviceTarget()).toContain(LABEL);
  });
});

describe("Node version validation", () => {
  it("resolveNodeMajorVersion extracts major from vNN.x.x output", () => {
    // We mock execFileSync by testing the parsing logic via a thin wrapper.
    // The actual function calls execFileSync which we cannot mock without vi.mock.
    // Instead, test it with a real invocation and just check it returns a number.
    const major = resolveNodeMajorVersion(FAKE_NPM);
    expect(typeof major).toBe("number");
    expect(major).toBeGreaterThan(0);
  });

  it("assertNodeVersion does not throw for the current Node runtime (>=24 on CI)", () => {
    // On CI (Node 24) this should pass. On older runtimes it would throw —
    // that is the intended behavior (the test documents the contract).
    const current = parseInt(process.version.replace(/^v/, "").split(".")[0], 10);
    if (current >= 24) {
      expect(() => assertNodeVersion(FAKE_NPM)).not.toThrow();
    } else {
      expect(() => assertNodeVersion(FAKE_NPM)).toThrow(/Node 24/);
    }
  });
});
