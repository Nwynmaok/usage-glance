import type { FastifyInstance } from "fastify";
import { loadConfig, getConfigStatus } from "../todolist/config.js";
import { readCache, writeCache, readCadence, writeCadence } from "../todolist/store.js";
import { queryNotionDatabase } from "../todolist/notion-client.js";
import { normalizeNotionPage } from "../todolist/notion-normalize.js";
import { scoreTasks } from "../todolist/scoring.js";
import type { CadenceState } from "../todolist/types.js";

type CadenceEvent =
  | "daily-startup-complete"
  | "daily-shutdown-complete"
  | "weekly-review-complete"
  | "select-focus";

const ALLOWED_EVENTS = new Set<CadenceEvent>([
  "daily-startup-complete",
  "daily-shutdown-complete",
  "weekly-review-complete",
  "select-focus",
]);

function currentDayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentWeekStr(): string {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((now.getTime() - jan1.getTime()) / 86_400_000 + jan1.getDay() + 1) / 7
  );
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export interface TodolistRouteOptions {
  cacheFile?: string;
  cadenceFile?: string;
  notionQuery?: typeof queryNotionDatabase;
}

export async function todolistRoutes(
  app: FastifyInstance,
  opts: TodolistRouteOptions = {}
): Promise<void> {
  const resolvedNotionQuery = opts.notionQuery ?? queryNotionDatabase;

  app.get("/api/todolist/status", async (_req, reply) => {
    const config = await loadConfig();
    const status = getConfigStatus(config);
    const cache = await readCache(opts.cacheFile);

    return reply.send({
      configured: status.configured,
      hasToken: status.hasToken,
      hasDatabaseId: status.hasDatabaseId,
      mappingWarnings: status.mappingWarnings,
      lastSyncAt: cache.lastSyncAt,
      degraded: cache.degraded,
      error: cache.error,
    });
  });

  app.post("/api/todolist/sync", async (_req, reply) => {
    const config = await loadConfig();
    const status = getConfigStatus(config);

    if (!status.configured) {
      const cache = await readCache(opts.cacheFile);
      return reply.send({
        lastSyncAt: cache.lastSyncAt,
        degraded: true,
        error: "Notion token and database ID are not configured.",
        focusCap: config.focus.dailyCap,
        recommendations: [],
        reviewCandidates: [],
      });
    }

    const prevCache = await readCache(opts.cacheFile);

    try {
      const pages = await resolvedNotionQuery({
        token: config.notion.token!,
        databaseId: config.notion.databaseId!,
      });

      const tasks = pages.map((p) =>
        normalizeNotionPage(p, config.notion.propertyMap)
      );

      const now = new Date();
      const syncAt = now.toISOString();

      const newCache = {
        lastSyncAt: syncAt,
        degraded: false,
        error: null,
        tasks,
      };
      await writeCache(newCache, opts.cacheFile);

      const { recommendations, reviewCandidates, focusCap } = scoreTasks(
        tasks,
        config,
        now
      );

      return reply.send({
        lastSyncAt: syncAt,
        degraded: false,
        error: null,
        focusCap,
        recommendations,
        reviewCandidates,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      await writeCache(
        { ...prevCache, degraded: true, error: errorMsg },
        opts.cacheFile
      );

      const { recommendations, reviewCandidates, focusCap } = scoreTasks(
        prevCache.tasks,
        config
      );

      return reply.send({
        lastSyncAt: prevCache.lastSyncAt,
        degraded: true,
        error: errorMsg,
        focusCap,
        recommendations,
        reviewCandidates,
      });
    }
  });

  app.get("/api/todolist/focus", async (_req, reply) => {
    const config = await loadConfig();
    const cache = await readCache(opts.cacheFile);

    if (!cache.lastSyncAt && !cache.degraded) {
      const status = getConfigStatus(config);
      return reply.send({
        configured: status.configured,
        lastSyncAt: null,
        degraded: false,
        error: null,
        focusCap: config.focus.dailyCap,
        recommendations: [],
        reviewCandidates: [],
        setupRequired: !status.configured,
        syncRequired: status.configured,
      });
    }

    const { recommendations, reviewCandidates, focusCap } = scoreTasks(
      cache.tasks,
      config
    );

    return reply.send({
      configured: getConfigStatus(config).configured,
      lastSyncAt: cache.lastSyncAt,
      degraded: cache.degraded,
      error: cache.error,
      focusCap,
      recommendations,
      reviewCandidates,
      setupRequired: false,
      syncRequired: false,
    });
  });

  app.post(
    "/api/todolist/cadence",
    async (req: { body: unknown }, reply) => {
      const body = req.body as {
        event?: string;
        selectedFocusPageIds?: string[];
      };

      const event = body?.event;
      if (!event || !ALLOWED_EVENTS.has(event as CadenceEvent)) {
        return reply
          .status(400)
          .send({ error: `Invalid or missing event. Allowed: ${[...ALLOWED_EVENTS].join(", ")}` });
      }

      const cadence = await readCadence(opts.cadenceFile);
      const now = new Date().toISOString();

      const updated: CadenceState = {
        ...cadence,
        currentDay: currentDayStr(),
        currentWeek: currentWeekStr(),
      };

      switch (event as CadenceEvent) {
        case "daily-startup-complete":
          updated.dailyStartupCompletedAt = now;
          break;
        case "daily-shutdown-complete":
          updated.dailyShutdownCompletedAt = now;
          break;
        case "weekly-review-complete":
          updated.weeklyReviewCompletedAt = now;
          break;
        case "select-focus":
          if (Array.isArray(body?.selectedFocusPageIds)) {
            updated.selectedFocusPageIds = body.selectedFocusPageIds;
          }
          break;
      }

      await writeCadence(updated, opts.cadenceFile);

      return reply.send({ ok: true, cadence: updated });
    }
  );
}
