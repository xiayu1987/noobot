/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentContextBuildEnvelope } from "@noobot/context-protocol/agent-context/envelope";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { buildTools } from "../../tools/index.js";
import { createRuntimeContext } from "../../runtime/runtime-context-factory.js";
import { initializeRuntimeEnvironment } from "../../runtime/capabilities/runtime-capability-initializer.js";
import { emitAgentContextDebug } from "../../observability/agent-context-debug.js";
import { createAgentContextEnvelopeInput } from "../agent-context-envelope-input.js";
import { createAgentExecutionScope } from "../agent-execution-scope.js";

export async function buildAgentExecutionContext({
  identity = {},
  caller = "user",
  globalConfig = {},
  userConfig = {},
  eventListener = null,
  sessionManager = null,
  attachmentService = null,
  botManager = null,
  userInteractionBridge = null,
  abortSignal = null,
  parentAsyncResultContainer = null,
  runConfig = {},
  runtimeBasePath = "",
  runtimeModel = "",
  allEnabledProviders = {},
  systemRuntime = {},
  staticAgentContext = {},
  systemMessages = [],
  conversationMessages = [],
  incrementalMessages = [],
  attachments = [],
  contextBuild = {},
} = {}) {
  const runtime = createRuntimeContext({
    userId: identity.userId,
    basePath: runtimeBasePath,
    globalConfig,
    userConfig,
    eventListener,
    sessionManager,
    attachmentService,
    botManager,
    userInteractionBridge,
    abortSignal,
    runtimeModel,
    allEnabledProviders,
    parentAsyncResultContainer,
    runConfig,
    systemRuntime,
    userMessageAttachments: attachments,
    sharedTools: {
      ...(runConfig?.sharedTools && typeof runConfig.sharedTools === "object"
        ? runConfig.sharedTools
        : {}),
      ...(botManager?.connectorAccessPort
        ? { connectorAccess: botManager.connectorAccessPort }
        : {}),
    },
  });
  await initializeRuntimeEnvironment(runtime);

  const envelope = createAgentContextBuildEnvelope(
    createAgentContextEnvelopeInput({
      userId: identity.userId,
      sessionId: identity.sessionId,
      rootSessionId: identity.rootSessionId,
      parentSessionId: identity.parentSessionId,
      dialogProcessId: identity.dialogProcessId,
      runConfig,
      caller,
      staticAgentContext,
      systemRuntime,
      runtimeModel,
      allEnabledProviders,
      contextBuild,
      systemMessages,
      conversationMessages,
      incrementalMessages,
    }),
  );
  const executionScope = createAgentExecutionScope({
    context: envelope,
    bindings: { runtime, tools: [] },
  });
  const tools = await buildTools({
    sessionId: identity.sessionId,
    parentSessionId: normalizeParentSessionId(identity.parentSessionId),
    agentContext: executionScope,
  });
  executionScope.bindings.tools = Array.isArray(tools) ? tools : [];
  emitAgentContextDebug(runtime.eventListener, executionScope);
  return executionScope;
}
