/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { createAgentContextBuildEnvelope } from "@noobot/context-protocol/agent-context/envelope";
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
  const { systemRuntime } = runtime;
  const resolvedIdentity = {
    userId: "u-test",
    sessionId: "s-1",
    rootSessionId: identity.sessionId || "s-1",
    parentSessionId: "",
    dialogProcessId: "d-1",
    turnScopeId: "t-1",
    runId: "r-1",
    messageId: "m-1",
    ...identity,
  };
  const context = createAgentContextBuildEnvelope({
    identity: resolvedIdentity,
    environment: {
      os: { platform: process.platform, arch: process.arch },
      workspace: { basePath: runtime.basePath },
      permissions: { isSuperUser: systemRuntime.isSuperUser === true },
      ...environment,
    },
    execution: { caller: "user", ...execution },
    messageBlocks,
    contextBuild: { mode: "test" },
  });
  return createAgentExecutionScope({
    context,
    bindings: { runtime, tools, extensions },
  });
}
