import { readFile } from "node:fs/promises";
import type { TodolistConfig, TodolistConfigStatus } from "./types.js";
import { resolvePaths } from "./paths.js";

const DEFAULT_PROPERTY_MAP = {
  title: "Name",
} as const;

const DEFAULT_FOCUS = {
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
} as const;

function buildDefaults(): TodolistConfig {
  return {
    notion: {
      propertyMap: { ...DEFAULT_PROPERTY_MAP },
    },
    focus: {
      ...DEFAULT_FOCUS,
      weights: { ...DEFAULT_FOCUS.weights },
    },
  };
}

function clampDailyCap(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : fallback;
  return Math.min(7, Math.max(1, Math.round(n)));
}

function deepMergeConfig(
  base: TodolistConfig,
  overrides: Partial<TodolistConfig>
): TodolistConfig {
  return {
    notion: {
      ...base.notion,
      ...overrides.notion,
      token: overrides.notion?.token ?? base.notion.token,
      databaseId: overrides.notion?.databaseId ?? base.notion.databaseId,
      propertyMap: {
        ...base.notion.propertyMap,
        ...overrides.notion?.propertyMap,
      },
    },
    focus: {
      ...base.focus,
      ...overrides.focus,
      weights: {
        ...base.focus.weights,
        ...overrides.focus?.weights,
      },
    },
  };
}

async function loadFileConfig(
  configPath: string
): Promise<Partial<TodolistConfig>> {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as Partial<TodolistConfig>;
  } catch {
    return {};
  }
}

export async function loadConfig(): Promise<TodolistConfig> {
  const paths = resolvePaths();
  const fileConfig = await loadFileConfig(paths.configFile);
  const config = deepMergeConfig(buildDefaults(), fileConfig);

  if (process.env["TODOLIST_NOTION_TOKEN"]) {
    config.notion.token = process.env["TODOLIST_NOTION_TOKEN"];
  }
  if (process.env["TODOLIST_NOTION_DATABASE_ID"]) {
    config.notion.databaseId = process.env["TODOLIST_NOTION_DATABASE_ID"];
  }

  config.focus.dailyCap = clampDailyCap(
    config.focus.dailyCap,
    DEFAULT_FOCUS.dailyCap
  );

  return config;
}

export function getMappingWarnings(config: TodolistConfig): string[] {
  const warnings: string[] = [];
  const map = config.notion.propertyMap;

  if (!map.title) {
    warnings.push("propertyMap.title is not set; defaulting to 'Name'");
  }
  if (!map.status) {
    warnings.push("propertyMap.status is not set; task status will be null");
  }
  if (!map.dueDate) {
    warnings.push(
      "propertyMap.dueDate is not set; due-date scoring will be skipped"
    );
  }

  return warnings;
}

export function getConfigStatus(config: TodolistConfig): TodolistConfigStatus {
  const warnings = getMappingWarnings(config);
  return {
    configured: !!(config.notion.token && config.notion.databaseId),
    hasToken: !!config.notion.token,
    hasDatabaseId: !!config.notion.databaseId,
    mappingWarnings: warnings,
  };
}
