export declare const LABEL: string;
export declare const REPO_ROOT: string;
export declare const PLIST_PATH: string;
export declare const LOG_DIR: string;
export declare const STDOUT_PATH: string;
export declare const STDERR_PATH: string;
export declare const WRAPPER_PATH: string;

export interface LaunchAgentPlistOptions {
  npmPath: string;
  port?: number;
}

export declare function buildLaunchAgentPlist(opts: LaunchAgentPlistOptions): string;
