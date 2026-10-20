/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimeOpsWorkdir } from "@noobot/path-resolver";
import {
  WORKSPACE_SANDBOX_PATHS,
  resolveToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";

export function resolveOperationDirectoryContext(ctx) {
  const { runtime } = ctx.agentContext.bindings;
  const { view, opsWorkdir } = resolveRuntimeOpsWorkdir({
    hostRootDirectory: runtime.basePath,
    userId: runtime.systemRuntime.userId,
    executionPolicy: resolveToolExecutionPolicy({
      toolName: "execute_script",
      globalConfig: runtime.globalConfig,
    }),
  });
  return {
    relativePath: WORKSPACE_SANDBOX_PATHS.OPS_WORKDIR_RELATIVE,
    absolutePath: opsWorkdir.replaceAll("\\", "/"),
    view,
  };
}

export function formatOperationDirectoryForRelay({ relativePath, absolutePath, view }) {
  return `[Harness operation dir] ${relativePath}\nUse (${view}): ${absolutePath}`;
}
