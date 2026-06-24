import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCache, writeCache, readCadence, writeCadence } from "../src/server/todolist/store.js";
import type { TodolistCache, CadenceState } from "../src/server/todolist/types.js";

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "todolist-store-test-"));
}

describe("todolist store", () => {
  describe("readCache", () => {
    it("returns default cache when file does not exist", async () => {
      const dir = await makeTmpDir();
      try {
        const cache = await readCache(join(dir, "cache.json"));
        expect(cache.lastSyncAt).toBeNull();
        expect(cache.degraded).toBe(false);
        expect(cache.error).toBeNull();
        expect(cache.tasks).toEqual([]);
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it("returns degraded cache when file is malformed JSON", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "cache.json");
      try {
        await writeFile(file, "{ not valid json }", "utf8");
        const cache = await readCache(file);
        expect(cache.tasks).toEqual([]);
        expect(cache.degraded).toBe(true);
        expect(cache.error).toMatch(/malformed cache file/);
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it("returns stored cache when file is valid", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "cache.json");
      try {
        const stored: TodolistCache = {
          lastSyncAt: "2026-06-23T10:00:00.000Z",
          degraded: false,
          error: null,
          tasks: [
            {
              notionPageId: "page-1",
              title: "Test task",
              status: "In Progress",
              priority: "High",
              dueDate: "2026-06-25",
              project: "Project A",
              effort: "medium",
              blocked: false,
              waiting: false,
              lastEditedAt: "2026-06-23T09:00:00.000Z",
              nextAction: "Do the thing",
              url: "https://notion.so/page-1",
            },
          ],
        };
        await writeFile(file, JSON.stringify(stored), "utf8");
        const cache = await readCache(file);
        expect(cache.lastSyncAt).toBe("2026-06-23T10:00:00.000Z");
        expect(cache.tasks).toHaveLength(1);
        expect(cache.tasks[0].title).toBe("Test task");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  describe("writeCache", () => {
    it("writes cache atomically and can be read back", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "nested", "cache.json");
      try {
        const data: TodolistCache = {
          lastSyncAt: "2026-06-23T12:00:00.000Z",
          degraded: false,
          error: null,
          tasks: [],
        };
        await writeCache(data, file);
        const readBack = await readCache(file);
        expect(readBack.lastSyncAt).toBe("2026-06-23T12:00:00.000Z");
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it("creates parent directories on write", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "deep", "nested", "dir", "cache.json");
      try {
        const data: TodolistCache = {
          lastSyncAt: null,
          degraded: true,
          error: "test error",
          tasks: [],
        };
        await expect(writeCache(data, file)).resolves.not.toThrow();
        const readBack = await readCache(file);
        expect(readBack.degraded).toBe(true);
        expect(readBack.error).toBe("test error");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  describe("readCadence", () => {
    it("returns default cadence when file does not exist", async () => {
      const dir = await makeTmpDir();
      try {
        const cadence = await readCadence(join(dir, "cadence-state.json"));
        expect(cadence.currentDay).toBe("");
        expect(cadence.dailyStartupCompletedAt).toBeNull();
        expect(cadence.dailyShutdownCompletedAt).toBeNull();
        expect(cadence.weeklyReviewCompletedAt).toBeNull();
        expect(cadence.selectedFocusPageIds).toEqual([]);
      } finally {
        await rm(dir, { recursive: true });
      }
    });

    it("returns default when file is malformed", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "cadence-state.json");
      try {
        await writeFile(file, "INVALID", "utf8");
        const cadence = await readCadence(file);
        expect(cadence.selectedFocusPageIds).toEqual([]);
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });

  describe("writeCadence", () => {
    it("writes cadence and can be read back", async () => {
      const dir = await makeTmpDir();
      const file = join(dir, "cadence-state.json");
      try {
        const data: CadenceState = {
          currentDay: "2026-06-23",
          currentWeek: "2026-W26",
          dailyStartupCompletedAt: "2026-06-23T08:00:00.000Z",
          dailyShutdownCompletedAt: null,
          weeklyReviewCompletedAt: null,
          selectedFocusPageIds: ["page-abc", "page-def"],
        };
        await writeCadence(data, file);
        const readBack = await readCadence(file);
        expect(readBack.currentDay).toBe("2026-06-23");
        expect(readBack.selectedFocusPageIds).toEqual(["page-abc", "page-def"]);
        expect(readBack.dailyStartupCompletedAt).toBe("2026-06-23T08:00:00.000Z");
      } finally {
        await rm(dir, { recursive: true });
      }
    });
  });
});
