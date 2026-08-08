/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function createTestAgentExecutionScope(runtime = {}, {
  identity = {},
  environment = {},
  execution = {},
  messageBlocks = {},
  tools = [],
  extensions = {},
} = {}) {
  const systemRuntime = runtime?.systemRuntime || {};
  const resolvedIdentity = {
    userId: String(identity.userId || runtime?.userId || systemRuntime?.userId || "u-test").trim(),
    sessionId: String(identity.sessionId || systemRuntime?.sessionId || "s-1").trim(),
    rootSessionId: String(identity.rootSessionId || systemRuntime?.rootSessionId || systemRuntime?.sessionId || "s-1").trim(),
    parentSessionId: String(identity.parentSessionId || systemRuntime?.parentSessionId || "").trim(),
    dialogProcessId: String(identity.dialogProcessId || systemRuntime?.dialogProcessId || "d-1").trim(),
    turnScopeId: String(identity.turnScopeId || systemRuntime?.turnScopeId || systemRuntime?.config?.turnScopeId || "t-1").trim(),
    runId: String(identity.runId || "r-1").trim(),
    messageId: String(identity.messageId || systemRuntime?.messageId || "m-1").trim(),
  };
  return {
    context: {
      kind: "noobot.agent-context",
      protocolVersion: 1,
      identity: resolvedIdentity,
      environment: {
        os: { platform: process.platform, arch: process.arch },
        workspace: { basePath: String(runtime?.basePath || "").trim() },
        permissions: { isSuperUser: runtime?.systemRuntime?.isSuperUser === true },
        ...environment,
      },
      execution: { caller: String(systemRuntime?.caller || "user"), ...execution },
      modelContext: {
        protocolVersion: 1,
        activeTurnIdentity: {
          dialogProcessId: resolvedIdentity.dialogProcessId,
          turnScopeId: resolvedIdentity.turnScopeId,
        },
        messageBlocks: {
          system: Array.isArray(messageBlocks.system) ? messageBlocks.system : [],
          history: Array.isArray(messageBlocks.history) ? messageBlocks.history : [],
          incremental: Array.isArray(messageBlocks.incremental) ? messageBlocks.incremental : [],
        },
      },
    },
    bindings: { runtime, tools, extensions },
  };
}
