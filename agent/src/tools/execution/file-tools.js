/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveToolExecutionPolicy } from "@noobot/execution-isolation-protocol";
import { createWorkspaceIoExecutor } from "../core/workspace-io-executor.js";
import { getSessionIdsFromAgentContext } from "../../context/agent-context-accessor.js";
import { TOOL_NAME } from "../constants/index.js";
import { createReadFileTool } from "./file-read-tool.js";
import { createWriteFileTool } from "./file-write-tool.js";
import { createSearchTool } from "./file-search-tool.js";
import { createPatchFileTool } from "./file-patch-tool.js";

export function createFileTool({ agentContext }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const workspaceIo = createWorkspaceIoExecutor({
    executionPolicy: resolveToolExecutionPolicy({
      toolName: TOOL_NAME.READ_FILE,
      globalConfig: runtime.globalConfig || {},
    }),
  });
  const mutationScopeId = getSessionIdsFromAgentContext(agentContext).turnScopeId;
  const context = { agentContext, runtime, workspaceIo };
  return [
    createReadFileTool(context),
    createWriteFileTool(context),
    createSearchTool(context),
    createPatchFileTool({ ...context, mutationScopeId }),
  ];
}
