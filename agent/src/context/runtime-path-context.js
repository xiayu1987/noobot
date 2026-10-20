/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimePathContext } from "@noobot/path-resolver";
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import { resolveConfiguredPathPolicy } from "../config/core/path-policy-adapter.js";
import { getSystemRuntimeFromRuntime } from "./agent-context-accessor.js";

export function resolveAgentRuntimePathContext(runtime, toolName) {
  const systemRuntime = getSystemRuntimeFromRuntime(runtime);
  const { globalConfig } = runtime;
  return resolveRuntimePathContext({
    hostRootDirectory: runtime.basePath,
    userId: systemRuntime.userId,
    globalConfig,
    executionPolicy: resolveToolExecutionPolicy({ toolName, globalConfig }),
    isSuperUser: systemRuntime.isSuperUser,
    pathPolicy: resolveConfiguredPathPolicy(globalConfig),
  });
}
