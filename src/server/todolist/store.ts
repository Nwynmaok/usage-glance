import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TodolistCache, CadenceState } from "./types.js";
import { resolvePaths } from "./paths.js";

const DEFAULT_CACHE: TodolistCache = {
  lastSyncAt: null,
  degraded: false,
  error: null,
  tasks: [],
};

const DEFAULT_CADENCE: CadenceState = {
  currentDay: "",
  currentWeek: "",
  dailyStartupCompletedAt: null,
  dailyShutdownCompletedAt: null,
  weeklyReviewCompletedAt: null,
  selectedFocusPageIds: [],
};

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, filePath);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function readCache(cacheFile?: string): Promise<TodolistCache> {
  const file = cacheFile ?? resolvePaths().cacheFile;
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { ...DEFAULT_CACHE, tasks: [] };
  }
  try {
    return JSON.parse(raw) as TodolistCache;
  } catch {
    return {
      lastSyncAt: null,
      degraded: true,
      error: "cache.json is malformed and could not be parsed",
      tasks: [],
    };
  }
}

export async function writeCache(
  data: TodolistCache,
  cacheFile?: string
): Promise<void> {
  const file = cacheFile ?? resolvePaths().cacheFile;
  await atomicWriteJson(file, data);
}

export async function readCadence(cadenceFile?: string): Promise<CadenceState> {
  const file = cadenceFile ?? resolvePaths().cadenceFile;
  return readJsonFile(file, { ...DEFAULT_CADENCE, selectedFocusPageIds: [] });
}

export async function writeCadence(
  data: CadenceState,
  cadenceFile?: string
): Promise<void> {
  const file = cadenceFile ?? resolvePaths().cadenceFile;
  await atomicWriteJson(file, data);
}
