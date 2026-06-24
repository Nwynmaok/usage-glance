import type { TodolistTask, FocusRecommendation, TodolistConfig } from "./types.js";

const HIGH_PRIORITY_VALUES = new Set(["high", "urgent", "critical", "p0", "p1"]);
const LOW_EFFORT_VALUES = new Set(["low", "small", "quick", "xs", "s"]);
const MS_PER_DAY = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_DAY;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function scoreTask(
  task: TodolistTask,
  config: TodolistConfig,
  now: Date
): { score: number; reasons: string[] } {
  const w = config.focus.weights;
  const reasons: string[] = [];
  let score = 0;

  if (task.dueDate) {
    const dueDateStr = task.dueDate.slice(0, 10);
    const nowDateStr = toDateStr(now);
    const in3DaysStr = toDateStr(addDays(now, 3));

    if (dueDateStr < nowDateStr) {
      score += w.overdue;
      const due = new Date(task.dueDate);
      const days = Math.max(1, Math.floor(daysBetween(due, now)));
      reasons.push(days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`);
    } else if (dueDateStr === nowDateStr) {
      score += w.dueSoon;
      reasons.push("Due today");
    } else if (dueDateStr <= in3DaysStr) {
      score += w.dueSoon;
      const due = new Date(task.dueDate);
      const days = Math.ceil(daysBetween(now, due));
      reasons.push(`Due in ${days} day(s)`);
    }
  }

  if (task.priority) {
    const p = task.priority.toLowerCase();
    if (HIGH_PRIORITY_VALUES.has(p)) {
      score += w.priority;
      reasons.push("High priority");
    }
  }

  if (task.lastEditedAt) {
    const lastEdited = new Date(task.lastEditedAt);
    const staleDays = daysBetween(lastEdited, now);
    if (staleDays >= config.focus.staleAfterDays) {
      score += w.stale;
      reasons.push(`Stale (${Math.floor(staleDays)} days since last edit)`);
    }
  }

  if (task.effort) {
    const e = task.effort.toLowerCase();
    if (LOW_EFFORT_VALUES.has(e)) {
      score += w.lowEffort;
      reasons.push("Low effort");
    }
  }

  if (task.blocked) {
    score -= w.blockedPenalty;
    reasons.push("Blocked");
  }

  if (task.waiting) {
    score -= w.waitingPenalty;
    reasons.push("Waiting");
  }

  return { score, reasons };
}

function deriveActionGuidance(
  task: TodolistTask,
  reasons: string[]
): FocusRecommendation["actionGuidance"] {
  if (task.blocked) return "review";
  if (task.waiting) return "review";
  if (!task.nextAction) return "review";
  if (reasons.includes("Stale (see reasons)") || reasons.some((r) => r.startsWith("Stale"))) {
    return "review";
  }
  if (task.effort) {
    const e = task.effort.toLowerCase();
    if (["large", "xl", "xxl", "l", "high"].includes(e)) return "split";
  }
  return "start";
}

export interface ReviewCandidate {
  task: TodolistTask;
  reviewReasons: string[];
}

export function computeReviewCandidates(
  tasks: TodolistTask[],
  config: TodolistConfig,
  now: Date
): ReviewCandidate[] {
  const results: ReviewCandidate[] = [];

  for (const task of tasks) {
    const reviewReasons: string[] = [];

    if (task.blocked) reviewReasons.push("Blocked");
    if (task.waiting) reviewReasons.push("Waiting");
    if (!task.nextAction) reviewReasons.push("Missing next action");

    if (task.lastEditedAt) {
      const lastEdited = new Date(task.lastEditedAt);
      const staleDays = daysBetween(lastEdited, now);
      if (staleDays >= config.focus.staleAfterDays) {
        reviewReasons.push(`Stale (${Math.floor(staleDays)} days)`);
      }
    }

    if (reviewReasons.length > 0) {
      results.push({ task, reviewReasons });
    }
  }

  return results;
}

export interface ScoringResult {
  recommendations: FocusRecommendation[];
  reviewCandidates: ReviewCandidate[];
  focusCap: number;
}

export function scoreTasks(
  tasks: TodolistTask[],
  config: TodolistConfig,
  now: Date = new Date()
): ScoringResult {
  const cap = Math.min(7, Math.max(1, config.focus.dailyCap));

  const scored = tasks.map((task) => {
    const { score, reasons } = scoreTask(task, config, now);
    const actionGuidance = deriveActionGuidance(task, reasons);
    return { task, score, reasons, actionGuidance } satisfies FocusRecommendation;
  });

  scored.sort((a, b) => b.score - a.score);

  const recommendations = scored.slice(0, cap);
  const reviewCandidates = computeReviewCandidates(tasks, config, now);

  return { recommendations, reviewCandidates, focusCap: cap };
}
