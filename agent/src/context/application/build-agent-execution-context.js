/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAgentContextEnvelope } from "@noobot/context-protocol/agent-context/envelope";
import { normalizeParentSessionId } from "@noobot/session-protocol";
import { buildTools } from "../../tools/index.js";
import { createRuntimeContext } from "../../runtime/runtime-context-factory.js";
import { createMainFlowControlPort } from "../../runtime/main-flow-control.js";
import { initializeRuntimeEnvironment } from "../../runtime/capabilities/runtime-capability-initializer.js";
import { emitAgentContextDebug } from "../../observability/agent-context-debug.js";
import { createAgentContextEnvelopeInput } from "../agent-context-envelope-input.js";
import { createAgentExecutionScope } from "../agent-execution-scope.js";

export async function buildAgentExecutionContext({
  identity,
  globalConfig,
  userConfig,
  eventListener,
  sessionManager,
  attachmentService,
  botManager,
  userInteractionBridge,
  abortSignal,
  runConfig,
  runtimeBasePath,
  runtimeModel,
  allEnabledProviders,
  systemRuntime,
  staticInfo,
  workspaceDirectories,
  systemMessages,
  conversationMessages,
  incrementalMessages,
  userMetaBackwrites,
  attachments,
}) {
  const runtime = createRuntimeContext({
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
    runConfig,
    systemRuntime,
    userMessageAttachments: attachments,
    sharedTools: {
      ...(botManager?.connectorAccessPort
        ? { connectorAccess: botManager.connectorAccessPort }
        : {}),
    },
  });
  await initializeRuntimeEnvironment(runtime);

  const envelope = createAgentContextEnvelope(
    createAgentContextEnvelopeInput({
      identity,
      runConfig,
      staticInfo,
      workspaceDirectories,
      systemRuntime,
      runtimeModel,
      allEnabledProviders,
      systemMessages,
      conversationMessages,
      incrementalMessages,
      userMetaBackwrites,
    }),
  );
  const executionScope = createAgentExecutionScope({
    context: envelope,
    bindings: {
      runtime,
      mainFlowControl: createMainFlowControlPort(runtime),
      tools: [],
      extensions: {},
    },
  });
  const tools = await buildTools({
    sessionId: identity.sessionId,
    parentSessionId: normalizeParentSessionId(identity.parentSessionId),
    agentContext: executionScope,
  });
  if (!Array.isArray(tools)) throw new TypeError("buildTools must return an array of tools");
  executionScope.bindings.tools = tools;
  emitAgentContextDebug(runtime.eventListener, executionScope);
  return executionScope;
}
