/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { safeNum } from "../shared/utils/shared-utils.js";

export function createAgentContextEnvelopeInput({
  userId = "",
  sessionId = "",
  parentSessionId = "",
  rootSessionId = "",
  dialogProcessId = "",
  runConfig = {},
  caller = "user",
  staticAgentContext = {},
  systemRuntime = {},
  runtimeModel = "",
  allEnabledProviders = {},
  contextBuild = {},
  systemMessages = [],
  conversationMessages = [],
  incrementalMessages = [],
} = {}) {
  return {
    identity: {
      userId,
      sessionId,
      rootSessionId,
      parentSessionId: normalizeParentSessionId(parentSessionId),
      dialogProcessId,
      turnScopeId: String(runConfig?.turnScopeId || "").trim(),
      runId: String(runConfig?.executionId || "").trim(),
      messageId: String(runConfig?.messageId || "").trim(),
    },
    environment: {
      os: {
        platform: staticAgentContext.platform || "",
        arch: staticAgentContext.arch || "",
        timezone: staticAgentContext.timezone || "",
        nodeVersion: staticAgentContext.nodeVersion || "",
      },
      workspace: {
        cwd: staticAgentContext.cwd || "",
        basePath: staticAgentContext.basePath || "",
        workspaceDirectories: Array.isArray(staticAgentContext.workspaceDirectories)
          ? staticAgentContext.workspaceDirectories
          : [],
        globalDefaults:
          staticAgentContext.globalDefaults && typeof staticAgentContext.globalDefaults === "object"
            ? staticAgentContext.globalDefaults
            : {},
      },
      permissions: { isSuperUser: systemRuntime.isSuperUser === true },
    },
    execution: {
      timestamp: String(systemRuntime.now || contextBuild.startedAt || "").trim(),
      caller: String(systemRuntime.caller || caller || "user").trim(),
      flags: {
        allowUserInteraction: systemRuntime?.config?.allowUserInteraction !== false,
        safeConfirm: systemRuntime?.config?.safeConfirm !== false,
        maxToolLoopTurns: safeNum(systemRuntime?.config?.maxToolLoopTurns),
      },
      model: { runtimeModel, allEnabledProviders },
      selectedConnectorIds: normalizeSelectedConnectorIds(
        systemRuntime?.config?.selectedConnectorIds,
      ),
    },
    contextBuild,
    messageBlocks: {
      system: Array.isArray(systemMessages) ? systemMessages : [],
      history: Array.isArray(conversationMessages) ? conversationMessages : [],
      incremental: Array.isArray(incrementalMessages) ? incrementalMessages : [],
    },
  };
}
