/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs } from "../../../config/index.js";
import { SANDBOX_CONFIG, TOOL_NAME } from "../../constants/index.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
export const DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS = TIME_THRESHOLDS.tools.dockerLockWaitTimeoutMs;
export const SANDBOX_PROVIDER_NAME = SANDBOX_CONFIG.PROVIDERS;
export const DOCKER_SANDBOX_DEFAULT = SANDBOX_CONFIG.DOCKER;
export const SANDBOX_COMMAND = SANDBOX_CONFIG.COMMANDS;
export const SCRIPT_WORKDIR_RELATIVE_PATH = "runtime/ops_workdir";
export const SCRIPT_EXECUTION_MODE = Object.freeze({
  FOREGROUND: "foreground",
  BACKGROUND: "background",
});
export const SCRIPT_RISK_LEVEL = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});
export const ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS = normalizeTimeMs(
  process.env.NOOBOT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  },
);
