/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createAgentContextBuildEnvelope } from "@noobot/context-protocol/agent-context-envelope";
import { createAgentExecutionScope } from "../../src/context/agent-execution-scope.js";

export function createTestAgentExecutionScope(
  runtime = {},
  {
    identity = {},
    environment = {},
    execution = {},
    messageBlocks = {},
    tools = [],
    extensions = {},
  } = {},
) {
  const systemRuntime = runtime?.systemRuntime || {};
  const resolvedIdentity = {
    userId: String(identity.userId || runtime?.userId || systemRuntime?.userId || "u-test").trim(),
    sessionId: String(identity.sessionId || systemRuntime?.sessionId || "s-1").trim(),
    rootSessionId: String(
      identity.rootSessionId || systemRuntime?.rootSessionId || systemRuntime?.sessionId || "s-1",
    ).trim(),
    parentSessionId: String(
      identity.parentSessionId || systemRuntime?.parentSessionId || "",
    ).trim(),
    dialogProcessId: String(
      identity.dialogProcessId || systemRuntime?.dialogProcessId || "d-1",
    ).trim(),
    turnScopeId: String(
      identity.turnScopeId ||
        systemRuntime?.turnScopeId ||
        systemRuntime?.config?.turnScopeId ||
        "t-1",
    ).trim(),
    runId: String(identity.runId || "r-1").trim(),
    messageId: String(identity.messageId || systemRuntime?.messageId || "m-1").trim(),
  };
  const context = createAgentContextBuildEnvelope({
    identity: resolvedIdentity,
    environment: {
      os: { platform: process.platform, arch: process.arch },
      workspace: { basePath: String(runtime?.basePath || "").trim() },
      permissions: { isSuperUser: runtime?.systemRuntime?.isSuperUser === true },
      ...environment,
    },
    execution: { caller: String(systemRuntime?.caller || "user"), ...execution },
    messageBlocks,
    contextBuild: { mode: "test" },
  });
  return createAgentExecutionScope({
    context,
    bindings: { runtime, tools, extensions },
  });
}
