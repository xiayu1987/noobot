/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTimeMs } from "../../../config/index.js";
import { SANDBOX_PROVIDER } from "@noobot/execution-isolation-protocol";
import { TOOL_NAME } from "../../constants/index.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const EXECUTE_SCRIPT_TOOL_NAME = TOOL_NAME.EXECUTE_SCRIPT;
export const DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS = TIME_THRESHOLDS.tools.dockerLockWaitTimeoutMs;
export const SANDBOX_PROVIDER_NAME = SANDBOX_PROVIDER;
export const SANDBOX_COMMAND = Object.freeze({ DOCKER: "docker" });
export const SCRIPT_EXECUTION_MODE = Object.freeze({
  FOREGROUND: "foreground",
  BACKGROUND: "background",
});
export const ENV_DOCKER_LOCK_WAIT_TIMEOUT_MS = normalizeTimeMs(
  process.env.NOOBOT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
  {
    fallback: DEFAULT_DOCKER_LOCK_WAIT_TIMEOUT_MS,
    min: 100,
  },
);
