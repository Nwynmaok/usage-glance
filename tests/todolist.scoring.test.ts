import { describe, it, expect } from "vitest";
import { scoreTasks, computeReviewCandidates } from "../src/server/todolist/scoring.js";
import type { TodolistTask, TodolistConfig } from "../src/server/todolist/types.js";

const BASE_CONFIG: TodolistConfig = {
  notion: {
    propertyMap: { title: "Name" },
  },
  focus: {
    dailyCap: 5,
    staleAfterDays: 14,
    longBlockedAfterDays: 7,
    weights: {
      dueSoon: 20,
      overdue: 30,
      priority: 15,
      stale: 5,
      lowEffort: 10,
      blockedPenalty: 40,
      waitingPenalty: 35,
    },
  },
};

function makeTask(overrides: Partial<TodolistTask> = {}): TodolistTask {
  return {
    notionPageId: "page-001",
    title: "Test task",
    status: null,
    priority: null,
    dueDate: null,
    project: null,
    effort: null,
    blocked: false,
    waiting: false,
    lastEditedAt: null,
    nextAction: "Do something",
    url: null,
    ...overrides,
  };
}

const NOW = new Date("2026-06-23T12:00:00.000Z");

describe("scoreTasks", () => {
  describe("cap behavior", () => {
    it("caps recommendations to dailyCap", () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask({ notionPageId: `page-${i}`, title: `Task ${i}` })
      );
      const result = scoreTasks(tasks, BASE_CONFIG, NOW);
      expect(result.recommendations).toHaveLength(BASE_CONFIG.focus.dailyCap);
      expect(result.focusCap).toBe(5);
    });

    it("returns fewer recommendations when tasks < cap", () => {
      const tasks = [makeTask(), makeTask({ notionPageId: "page-2" })];
      const result = scoreTasks(tasks, BASE_CONFIG, NOW);
      expect(result.recommendations).toHaveLength(2);
    });

    it("clamps dailyCap to max 7", () => {
      const config = { ...BASE_CONFIG, focus: { ...BASE_CONFIG.focus, dailyCap: 99 } };
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask({ notionPageId: `page-${i}` })
      );
      const result = scoreTasks(tasks, config, NOW);
      expect(result.focusCap).toBe(7);
      expect(result.recommendations).toHaveLength(7);
    });

    it("clamps dailyCap to min 1", () => {
      const config = { ...BASE_CONFIG, focus: { ...BASE_CONFIG.focus, dailyCap: 0 } };
      const tasks = [makeTask(), makeTask({ notionPageId: "page-2" })];
      const result = scoreTasks(tasks, config, NOW);
      expect(result.focusCap).toBe(1);
      expect(result.recommendations).toHaveLength(1);
    });
  });

  describe("overdue reason", () => {
    it("adds overdue score and reason for past due date", () => {
      const task = makeTask({ dueDate: "2026-06-20" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.score).toBeGreaterThanOrEqual(BASE_CONFIG.focus.weights.overdue);
      expect(rec.reasons.some((r) => r.includes("Overdue"))).toBe(true);
    });
  });

  describe("due soon reason", () => {
    it("adds dueSoon score for date within 3 days", () => {
      const task = makeTask({ dueDate: "2026-06-25" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.score).toBeGreaterThanOrEqual(BASE_CONFIG.focus.weights.dueSoon);
      expect(rec.reasons.some((r) => r.includes("Due"))).toBe(true);
    });

    it("adds 'Due today' reason for same-day due date", () => {
      const task = makeTask({ dueDate: "2026-06-23" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.reasons.some((r) => r.includes("Due today"))).toBe(true);
    });

    it("does not add dueSoon for far-future date", () => {
      const task = makeTask({ dueDate: "2027-01-01" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.score).toBe(0);
      expect(rec.reasons.some((r) => r.includes("Due"))).toBe(false);
    });
  });

  describe("priority reason", () => {
    it("adds priority score for high priority", () => {
      const task = makeTask({ priority: "High" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.score).toBeGreaterThanOrEqual(BASE_CONFIG.focus.weights.priority);
      expect(rec.reasons.some((r) => r.includes("priority"))).toBe(true);
    });

    it("adds priority score for 'urgent' (case-insensitive)", () => {
      const task = makeTask({ priority: "urgent" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.reasons.some((r) => r.includes("priority"))).toBe(true);
    });

    it("does not add priority score for normal/low priority", () => {
      const task = makeTask({ priority: "Low" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.reasons.some((r) => r.includes("priority"))).toBe(false);
    });
  });

  describe("stale reason", () => {
    it("adds stale reason when last edited >= staleAfterDays ago", () => {
      const staleDate = new Date(NOW);
      staleDate.setDate(staleDate.getDate() - 15);
      const task = makeTask({ lastEditedAt: staleDate.toISOString() });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.reasons.some((r) => r.includes("Stale"))).toBe(true);
    });

    it("does not add stale reason when recently edited", () => {
      const recentDate = new Date(NOW);
      recentDate.setDate(recentDate.getDate() - 3);
      const task = makeTask({ lastEditedAt: recentDate.toISOString() });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      const rec = result.recommendations[0];
      expect(rec.reasons.some((r) => r.includes("Stale"))).toBe(false);
    });
  });

  describe("blocked/waiting penalties", () => {
    it("applies blocked penalty to score", () => {
      const normalTask = makeTask({ notionPageId: "normal", priority: "High" });
      const blockedTask = makeTask({ notionPageId: "blocked", priority: "High", blocked: true });
      const result = scoreTasks([normalTask, blockedTask], BASE_CONFIG, NOW);
      const normalRec = result.recommendations.find((r) => r.task.notionPageId === "normal");
      const blockedRec = result.recommendations.find((r) => r.task.notionPageId === "blocked");
      expect(normalRec!.score).toBeGreaterThan(blockedRec!.score);
      expect(blockedRec!.reasons.some((r) => r.includes("Blocked"))).toBe(true);
    });

    it("applies waiting penalty to score", () => {
      const normalTask = makeTask({ notionPageId: "normal" });
      const waitingTask = makeTask({ notionPageId: "waiting", waiting: true });
      const result = scoreTasks([normalTask, waitingTask], BASE_CONFIG, NOW);
      const waitingRec = result.recommendations.find((r) => r.task.notionPageId === "waiting");
      expect(waitingRec!.score).toBeLessThan(0);
      expect(waitingRec!.reasons.some((r) => r.includes("Waiting"))).toBe(true);
    });

    it("gives blocked tasks 'review' actionGuidance", () => {
      const task = makeTask({ blocked: true });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      expect(result.recommendations[0].actionGuidance).toBe("review");
    });

    it("gives waiting tasks 'review' actionGuidance", () => {
      const task = makeTask({ waiting: true });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      expect(result.recommendations[0].actionGuidance).toBe("review");
    });
  });

  describe("action guidance", () => {
    it("returns 'start' for a normal ready task with next action", () => {
      const task = makeTask({ nextAction: "Write tests" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      expect(result.recommendations[0].actionGuidance).toBe("start");
    });

    it("returns 'review' for task missing next action", () => {
      const task = makeTask({ nextAction: null });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      expect(result.recommendations[0].actionGuidance).toBe("review");
    });

    it("returns 'split' for large-effort task", () => {
      const task = makeTask({ effort: "Large", nextAction: "Break it down" });
      const result = scoreTasks([task], BASE_CONFIG, NOW);
      expect(result.recommendations[0].actionGuidance).toBe("split");
    });
  });

  describe("sorting", () => {
    it("returns highest-scored tasks first", () => {
      const lowTask = makeTask({ notionPageId: "low" });
      const highTask = makeTask({
        notionPageId: "high",
        priority: "High",
        dueDate: "2026-06-23",
      });
      const result = scoreTasks([lowTask, highTask], BASE_CONFIG, NOW);
      expect(result.recommendations[0].task.notionPageId).toBe("high");
    });
  });
});

describe("computeReviewCandidates", () => {
  it("includes blocked tasks as review candidates", () => {
    const task = makeTask({ blocked: true });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reviewReasons.some((r) => r.includes("Blocked"))).toBe(true);
  });

  it("includes waiting tasks as review candidates", () => {
    const task = makeTask({ waiting: true });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reviewReasons.some((r) => r.includes("Waiting"))).toBe(true);
  });

  it("includes tasks with missing next action", () => {
    const task = makeTask({ nextAction: null });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reviewReasons.some((r) => r.includes("next action"))).toBe(true);
  });

  it("includes stale tasks", () => {
    const staleDate = new Date(NOW);
    staleDate.setDate(staleDate.getDate() - 20);
    const task = makeTask({ lastEditedAt: staleDate.toISOString() });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reviewReasons.some((r) => r.includes("Stale"))).toBe(true);
  });

  it("does not include healthy tasks", () => {
    const recentDate = new Date(NOW);
    recentDate.setDate(recentDate.getDate() - 2);
    const task = makeTask({
      lastEditedAt: recentDate.toISOString(),
      nextAction: "Do the thing",
      blocked: false,
      waiting: false,
    });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates).toHaveLength(0);
  });

  it("can combine multiple review reasons on one task", () => {
    const staleDate = new Date(NOW);
    staleDate.setDate(staleDate.getDate() - 20);
    const task = makeTask({
      blocked: true,
      nextAction: null,
      lastEditedAt: staleDate.toISOString(),
    });
    const candidates = computeReviewCandidates([task], BASE_CONFIG, NOW);
    expect(candidates[0].reviewReasons.length).toBeGreaterThanOrEqual(3);
  });
});
