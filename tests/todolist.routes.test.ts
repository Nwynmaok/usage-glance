import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { todolistRoutes } from "../src/server/routes/todolist.js";
import type { NotionPage } from "../src/server/todolist/notion-client.js";

let tmpDir: string;
let cacheFile: string;
let cadenceFile: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "todolist-routes-test-"));
  cacheFile = join(tmpDir, "cache.json");
  cadenceFile = join(tmpDir, "cadence-state.json");

  process.env["TODOLIST_DATA_DIR"] = tmpDir;
  process.env["TODOLIST_CONFIG_PATH"] = join(tmpDir, "todolist.config.json");
  delete process.env["TODOLIST_NOTION_TOKEN"];
  delete process.env["TODOLIST_NOTION_DATABASE_ID"];
});

afterEach(async () => {
  delete process.env["TODOLIST_DATA_DIR"];
  delete process.env["TODOLIST_CONFIG_PATH"];
  delete process.env["TODOLIST_NOTION_TOKEN"];
  delete process.env["TODOLIST_NOTION_DATABASE_ID"];
  await rm(tmpDir, { recursive: true, force: true });
});

async function buildTestApp(opts: {
  notionQuery?: (o: { token: string; databaseId: string }) => Promise<NotionPage[]>;
} = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(todolistRoutes, {
    cacheFile,
    cadenceFile,
    notionQuery: opts.notionQuery,
  });
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/todolist/status
// ---------------------------------------------------------------------------
describe("GET /api/todolist/status", () => {
  it("returns unconfigured state when no token/db set", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/todolist/status" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      configured: boolean;
      hasToken: boolean;
      hasDatabaseId: boolean;
      mappingWarnings: string[];
      lastSyncAt: string | null;
      degraded: boolean;
      error: string | null;
    }>();

    expect(body.configured).toBe(false);
    expect(body.hasToken).toBe(false);
    expect(body.hasDatabaseId).toBe(false);
    expect(body.lastSyncAt).toBeNull();
    expect(body.degraded).toBe(false);
    expect(body.error).toBeNull();
  });

  it("does not expose raw token or database id", async () => {
    process.env["TODOLIST_NOTION_TOKEN"] = "secret-token";
    process.env["TODOLIST_NOTION_DATABASE_ID"] = "secret-db";
    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/todolist/status" });
    await app.close();

    const bodyStr = res.body;
    expect(bodyStr).not.toContain("secret-token");
    expect(bodyStr).not.toContain("secret-db");

    const body = res.json<{ configured: boolean; hasToken: boolean; hasDatabaseId: boolean }>();
    expect(body.configured).toBe(true);
    expect(body.hasToken).toBe(true);
    expect(body.hasDatabaseId).toBe(true);
  });

  it("reflects last sync state from cache", async () => {
    const { writeCache: wc } = await import("../src/server/todolist/store.js");
    await wc(
      { lastSyncAt: "2026-06-23T22:00:00.000Z", degraded: false, error: null, tasks: [] },
      cacheFile
    );

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/todolist/status" });
    await app.close();

    const body = res.json<{ lastSyncAt: string }>();
    expect(body.lastSyncAt).toBe("2026-06-23T22:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// GET /api/todolist/focus
// ---------------------------------------------------------------------------
describe("GET /api/todolist/focus", () => {
  it("returns empty/sync-required state when no cache", async () => {
    process.env["TODOLIST_NOTION_TOKEN"] = "t";
    process.env["TODOLIST_NOTION_DATABASE_ID"] = "d";

    const app = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/api/todolist/focus" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      recommendations: unknown[];
      syncRequired: boolean;
      lastSyncAt: null;
    }>();
    expect(body.recommendations).toHaveLength(0);
    expect(body.syncRequired).toBe(true);
    expect(body.lastSyncAt).toBeNull();
  });

  it("returns focus from cache without calling Notion", async () => {
    const { writeCache: wc } = await import("../src/server/todolist/store.js");
    const task = {
      notionPageId: "page-1",
      title: "Test task",
      status: "In Progress",
      priority: "high",
      dueDate: null,
      project: null,
      effort: "low",
      blocked: false,
      waiting: false,
      lastEditedAt: null,
      nextAction: "do something",
      url: null,
    };
    await wc(
      { lastSyncAt: "2026-06-23T22:00:00.000Z", degraded: false, error: null, tasks: [task] },
      cacheFile
    );

    let notionCalled = false;
    const app = await buildTestApp({
      notionQuery: async () => {
        notionCalled = true;
        return [];
      },
    });

    const res = await app.inject({ method: "GET", url: "/api/todolist/focus" });
    await app.close();

    expect(notionCalled).toBe(false);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ recommendations: Array<{ task: { title: string } }> }>();
    expect(body.recommendations[0]?.task.title).toBe("Test task");
  });
});

// ---------------------------------------------------------------------------
// POST /api/todolist/sync
// ---------------------------------------------------------------------------
describe("POST /api/todolist/sync", () => {
  it("returns degraded if not configured", async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: "POST", url: "/api/todolist/sync", payload: {} });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ degraded: boolean; error: string }>();
    expect(body.degraded).toBe(true);
    expect(body.error).toContain("not configured");
  });

  it("successful sync writes cache and returns recommendations", async () => {
    process.env["TODOLIST_NOTION_TOKEN"] = "t";
    process.env["TODOLIST_NOTION_DATABASE_ID"] = "d";

    const mockPage: NotionPage = {
      id: "page-abc",
      url: "https://notion.so/page-abc",
      properties: {
        Name: {
          type: "title",
          title: [{ plain_text: "My synced task" }],
        },
      },
      last_edited_time: "2026-06-01T00:00:00.000Z",
    };

    const app = await buildTestApp({
      notionQuery: async () => [mockPage],
    });

    const res = await app.inject({ method: "POST", url: "/api/todolist/sync", payload: {} });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      degraded: boolean;
      lastSyncAt: string;
      recommendations: unknown[];
    }>();
    expect(body.degraded).toBe(false);
    expect(body.lastSyncAt).toBeTruthy();
    expect(Array.isArray(body.recommendations)).toBe(true);
  });

  it("failed sync preserves last cache and returns degraded state", async () => {
    process.env["TODOLIST_NOTION_TOKEN"] = "t";
    process.env["TODOLIST_NOTION_DATABASE_ID"] = "d";

    const { writeCache: wc } = await import("../src/server/todolist/store.js");
    const prevSyncAt = "2026-06-20T10:00:00.000Z";
    const prevTask = {
      notionPageId: "old-page",
      title: "Old task",
      status: null,
      priority: null,
      dueDate: null,
      project: null,
      effort: null,
      blocked: false,
      waiting: false,
      lastEditedAt: null,
      nextAction: null,
      url: null,
    };
    await wc(
      { lastSyncAt: prevSyncAt, degraded: false, error: null, tasks: [prevTask] },
      cacheFile
    );

    const app = await buildTestApp({
      notionQuery: async () => {
        throw new Error("Notion API unavailable");
      },
    });

    const res = await app.inject({ method: "POST", url: "/api/todolist/sync", payload: {} });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      degraded: boolean;
      error: string;
      lastSyncAt: string;
      recommendations: unknown[];
      reviewCandidates: unknown[];
      focusCap: number;
    }>();
    expect(body.degraded).toBe(true);
    expect(body.error).toContain("Notion API unavailable");
    expect(body.lastSyncAt).toBe(prevSyncAt);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(Array.isArray(body.reviewCandidates)).toBe(true);
    expect(typeof body.focusCap).toBe("number");
    // prevTask has nextAction: null so it appears as a review candidate
    expect(body.reviewCandidates).toHaveLength(1);

    // Cache on disk should still have old tasks
    const { readCache } = await import("../src/server/todolist/store.js");
    const savedCache = await readCache(cacheFile);
    expect(savedCache.tasks).toHaveLength(1);
    expect(savedCache.tasks[0]?.title).toBe("Old task");
    expect(savedCache.degraded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/todolist/cadence
// ---------------------------------------------------------------------------
describe("POST /api/todolist/cadence", () => {
  it("rejects invalid event", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/todolist/cadence",
      payload: { event: "not-an-event" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("records daily-startup-complete", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/todolist/cadence",
      payload: { event: "daily-startup-complete" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; cadence: { dailyStartupCompletedAt: string } }>();
    expect(body.ok).toBe(true);
    expect(body.cadence.dailyStartupCompletedAt).toBeTruthy();
  });

  it("records daily-shutdown-complete", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/todolist/cadence",
      payload: { event: "daily-shutdown-complete" },
    });
    await app.close();

    const body = res.json<{ cadence: { dailyShutdownCompletedAt: string } }>();
    expect(body.cadence.dailyShutdownCompletedAt).toBeTruthy();
  });

  it("records weekly-review-complete", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/todolist/cadence",
      payload: { event: "weekly-review-complete" },
    });
    await app.close();

    const body = res.json<{ cadence: { weeklyReviewCompletedAt: string } }>();
    expect(body.cadence.weeklyReviewCompletedAt).toBeTruthy();
  });

  it("records select-focus with page ids", async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/todolist/cadence",
      payload: { event: "select-focus", selectedFocusPageIds: ["id-1", "id-2"] },
    });
    await app.close();

    const body = res.json<{ cadence: { selectedFocusPageIds: string[] } }>();
    expect(body.cadence.selectedFocusPageIds).toEqual(["id-1", "id-2"]);
  });
});

// ---------------------------------------------------------------------------
// GET /healthz still passes
// ---------------------------------------------------------------------------
describe("GET /healthz compatibility", () => {
  it("healthz still returns 200 when todolist routes are registered", async () => {
    const { buildApp } = await import("../src/server/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe("ok");
  });
});
