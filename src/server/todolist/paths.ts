import { homedir } from "node:os";
import { join } from "node:path";

export interface TodolistPaths {
  configFile: string;
  dataDir: string;
  cacheFile: string;
  cadenceFile: string;
}

export function resolvePaths(): TodolistPaths {
  const configFile =
    process.env["TODOLIST_CONFIG_PATH"] ??
    join(homedir(), ".config", "usage-glance", "todolist.config.json");

  const dataDir =
    process.env["TODOLIST_DATA_DIR"] ??
    join(homedir(), ".local", "state", "usage-glance", "todolist");

  return {
    configFile,
    dataDir,
    cacheFile: join(dataDir, "cache.json"),
    cadenceFile: join(dataDir, "cadence-state.json"),
  };
}
