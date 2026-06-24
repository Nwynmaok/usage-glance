export interface TodolistConfig {
  notion: {
    token?: string;
    databaseId?: string;
    propertyMap: {
      title: string;
      status?: string;
      priority?: string;
      dueDate?: string;
      project?: string;
      effort?: string;
      blocked?: string;
      waiting?: string;
      lastEdited?: string;
      nextAction?: string;
    };
  };
  focus: {
    dailyCap: number;
    staleAfterDays: number;
    longBlockedAfterDays: number;
    weights: {
      dueSoon: number;
      overdue: number;
      priority: number;
      stale: number;
      lowEffort: number;
      blockedPenalty: number;
      waitingPenalty: number;
    };
  };
}

export interface TodolistCache {
  lastSyncAt: string | null;
  degraded: boolean;
  error: string | null;
  tasks: TodolistTask[];
}

export interface CadenceState {
  currentDay: string;
  currentWeek: string;
  dailyStartupCompletedAt: string | null;
  dailyShutdownCompletedAt: string | null;
  weeklyReviewCompletedAt: string | null;
  selectedFocusPageIds: string[];
}

export interface TodolistTask {
  notionPageId: string;
  title: string;
  status: string | null;
  priority: string | null;
  dueDate: string | null;
  project: string | null;
  effort: string | null;
  blocked: boolean;
  waiting: boolean;
  lastEditedAt: string | null;
  nextAction: string | null;
  url: string | null;
}

export interface FocusRecommendation {
  task: TodolistTask;
  score: number;
  reasons: string[];
  actionGuidance: "start" | "split" | "defer" | "mark-blocked" | "review";
}

export interface TodolistConfigStatus {
  configured: boolean;
  hasToken: boolean;
  hasDatabaseId: boolean;
  mappingWarnings: string[];
}
