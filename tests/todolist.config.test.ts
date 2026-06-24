import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, getConfigStatus, getMappingWarnings } from "../src/server/todolist/config.js";
import type { TodolistConfig } from "../src/server/todolist/types.js";

describe("todolist config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env["TODOLIST_NOTION_TOKEN"];
    delete process.env["TODOLIST_NOTION_DATABASE_ID"];
    delete process.env["TODOLIST_CONFIG_PATH"];
    delete process.env["TODOLIST_DATA_DIR"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadConfig defaults", () => {
    it("returns defaults when no env or file is set", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      const config = await loadConfig();

      expect(config.focus.dailyCap).toBe(5);
      expect(config.focus.staleAfterDays).toBe(14);
      expect(config.focus.longBlockedAfterDays).toBe(7);
      expect(config.notion.propertyMap.title).toBe("Name");
      expect(config.notion.token).toBeUndefined();
      expect(config.notion.databaseId).toBeUndefined();
    });

    it("picks up TODOLIST_NOTION_TOKEN from env", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      process.env["TODOLIST_NOTION_TOKEN"] = "secret-token-value";
      const config = await loadConfig();

      expect(config.notion.token).toBe("secret-token-value");
    });

    it("picks up TODOLIST_NOTION_DATABASE_ID from env", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      process.env["TODOLIST_NOTION_DATABASE_ID"] = "db-12345";
      const config = await loadConfig();

      expect(config.notion.databaseId).toBe("db-12345");
    });
  });

  describe("dailyCap clamping", () => {
    it("clamps cap to max 7", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      const config = await loadConfig();
      config.focus.dailyCap = 99;
      const clamped = Math.min(7, Math.max(1, config.focus.dailyCap));
      expect(clamped).toBe(7);
    });

    it("clamps cap to min 1", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      const config = await loadConfig();
      config.focus.dailyCap = 0;
      const clamped = Math.min(7, Math.max(1, config.focus.dailyCap));
      expect(clamped).toBe(1);
    });
  });

  describe("getConfigStatus - secret safety", () => {
    it("returns hasToken true when token is set, without exposing the token", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      process.env["TODOLIST_NOTION_TOKEN"] = "super-secret-token";
      const config = await loadConfig();
      const status = getConfigStatus(config);

      expect(status.hasToken).toBe(true);
      expect(status.hasDatabaseId).toBe(false);
      expect(status.configured).toBe(false);

      const statusStr = JSON.stringify(status);
      expect(statusStr).not.toContain("super-secret-token");
    });

    it("returns hasToken false when token is not set", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      const config = await loadConfig();
      const status = getConfigStatus(config);

      expect(status.hasToken).toBe(false);
      expect(status.hasDatabaseId).toBe(false);
      expect(status.configured).toBe(false);
    });

    it("returns configured true when both token and databaseId are set", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      process.env["TODOLIST_NOTION_TOKEN"] = "my-token";
      process.env["TODOLIST_NOTION_DATABASE_ID"] = "my-db-id";
      const config = await loadConfig();
      const status = getConfigStatus(config);

      expect(status.configured).toBe(true);
      expect(status.hasToken).toBe(true);
      expect(status.hasDatabaseId).toBe(true);

      const statusStr = JSON.stringify(status);
      expect(statusStr).not.toContain("my-token");
      expect(statusStr).not.toContain("my-db-id");
    });

    it("status object has no token or databaseId fields", async () => {
      process.env["TODOLIST_CONFIG_PATH"] = "/nonexistent/path/todolist.config.json";
      process.env["TODOLIST_NOTION_TOKEN"] = "secret";
      process.env["TODOLIST_NOTION_DATABASE_ID"] = "db-secret";
      const config = await loadConfig();
      const status = getConfigStatus(config);

      expect(Object.keys(status)).not.toContain("token");
      expect(Object.keys(status)).not.toContain("databaseId");
      expect(Object.keys(status)).not.toContain("notion");
    });
  });

  describe("getMappingWarnings", () => {
    it("warns about missing optional mappings", () => {
      const config: TodolistConfig = {
        notion: {
          propertyMap: { title: "Name" },
        },
        focus: {
          dailyCap: 5,
          staleAfterDays: 14,
          longBlockedAfterDays: 7,
          weights: {
            dueSoon: 20, overdue: 30, priority: 15, stale: 5,
            lowEffort: 10, blockedPenalty: 40, waitingPenalty: 35,
          },
        },
      };
      const warnings = getMappingWarnings(config);
      expect(warnings.some((w) => w.includes("status"))).toBe(true);
      expect(warnings.some((w) => w.includes("dueDate"))).toBe(true);
    });

    it("produces no title warning when title is set", () => {
      const config: TodolistConfig = {
        notion: {
          propertyMap: { title: "Task Name", status: "Status", dueDate: "Due" },
        },
        focus: {
          dailyCap: 5,
          staleAfterDays: 14,
          longBlockedAfterDays: 7,
          weights: {
            dueSoon: 20, overdue: 30, priority: 15, stale: 5,
            lowEffort: 10, blockedPenalty: 40, waitingPenalty: 35,
          },
        },
      };
      const warnings = getMappingWarnings(config);
      expect(warnings.some((w) => w.includes("title"))).toBe(false);
    });
  });
});
