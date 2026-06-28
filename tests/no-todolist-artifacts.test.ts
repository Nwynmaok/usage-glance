import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";

// Files explicitly allowed to mention todolist terms:
// - CLEANUP.md: documents what was removed
// - this guard file: defines the forbidden terms itself
const ALLOWLIST = new Set(["CLEANUP.md", "tests/no-todolist-artifacts.test.ts"]);

// Terms that must not appear in tracked usage-glance source files.
const FORBIDDEN_TERMS = [
  "todolist",
  "todo-list",
  "Todolist Coach",
  "notion-client",
  "notion-normalize",
  "TodolistConfig",
  "TodolistStore",
  "TodolistItem",
];

describe("no-todolist-artifacts", () => {
  it("tracked source files contain no Todolist-specific references", () => {
    const tracked = execSync("git ls-files", { encoding: "utf-8" })
      .trim()
      .split("\n")
      .filter((f) => f && !ALLOWLIST.has(f));

    const hits: string[] = [];

    for (const file of tracked) {
      let content: string;
      try {
        content = readFileSync(file, "utf-8");
      } catch {
        continue; // binary or unreadable file
      }

      for (const term of FORBIDDEN_TERMS) {
        if (content.toLowerCase().includes(term.toLowerCase())) {
          hits.push(`${file}: contains "${term}"`);
          break;
        }
      }
    }

    expect(hits, `Todolist artifact(s) found:\n${hits.join("\n")}`).toEqual([]);
  });
});
