/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";
import { emitEvent } from "../events/index.js";
import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../context/assembly/message-builder.js";
import {
  getAgentContextEnvelope,
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
  getToolsFromAgentContext,
} from "../context/agent-context-accessor.js";
import { DEFAULT_MAX_TOOL_LOOP_TURNS } from "./constants/index.js";
import {
  normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpec,
  resolveHelpPromptLoopTurns,
  resolveMaxToolLoopTurns,
  resolvePhaseSummaryMessageCharsThreshold,
  resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurns,
  resolveToolFailureHelpCount,
} from "./run-config/index.js";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { emitModelContextTrace } from "../observability/model-context-trace-emitter.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";
import {
  canonicalMessageId,
  canonicalMessageIdentityDebugData,
  emitContextIdentityDebug,
} from "../observability/context-identity-debug.js";
import { emitAgentContextProtocolDebug } from "../observability/agent-context-protocol-debug.js";
import { initializeAgentModelHost } from "./model-port-host.js";

function trimmedText(value) {
  return String(value || "").trim();
}

function resolveLoopConfig(resolvers, sys, effectiveConfig, runConfig) {
  return {
    maxToolLoopTurns: resolvers.resolveMaxToolLoopTurnsFn({
      systemRuntime: sys,
      effectiveConfig,
    }),
    phaseSummaryLoopTurns: resolvers.resolvePhaseSummaryLoopTurnsFn({ runConfig }),
    taskCheckLoopTurns: resolvers.resolveTaskCheckLoopTurnsFn({ runConfig }),
    phaseSummaryMessageCharsThreshold:
      resolvers.resolvePhaseSummaryMessageCharsThresholdFn(effectiveConfig),
    helpPromptLoopTurns: resolvers.resolveHelpPromptLoopTurnsFn(effectiveConfig),
    toolFailureHelpCount: resolvers.resolveToolFailureHelpCountFn(effectiveConfig),
  };
}

function resolveActiveTurnIdentity(currentUserMessage, context) {
  const activeTurnIdentity = {
    dialogProcessId: trimmedText(currentUserMessage?.dialogProcessId),
    turnScopeId: trimmedText(currentUserMessage?.turnScopeId),
  };
  if (!activeTurnIdentity.dialogProcessId || !activeTurnIdentity.turnScopeId) {
    throw new Error("current canonical user message requires dialogProcessId and turnScopeId");
  }
  const contextIdentity = context.identity || {};
  for (const [field, currentValue] of Object.entries(activeTurnIdentity)) {
    const contextValue = trimmedText(contextIdentity[field]);
    if (!contextValue) throw new Error(`agent context identity.${field} is required`);
    if (contextValue !== currentValue) {
      throw new Error(
        `current canonical user message ${field} conflicts with agent context identity`,
      );
    }
  }
  return { activeTurnIdentity, contextIdentity };
}

function resolveInvocationIdentity(contextIdentity, activeTurnIdentity) {
  const invocationIdentity = {
    sessionId: trimmedText(contextIdentity.sessionId),
    parentSessionId: trimmedText(contextIdentity.parentSessionId),
    dialogProcessId: activeTurnIdentity.dialogProcessId,
    turnScopeId: activeTurnIdentity.turnScopeId,
    runId: trimmedText(contextIdentity.runId),
  };
  for (const field of ["sessionId", "dialogProcessId", "turnScopeId", "runId"]) {
    if (!invocationIdentity[field]) throw new Error(`agent model identity.${field} is required`);
  }
  return invocationIdentity;
}

function assertRuntimeIdentityConsistent(runtime, sys, invocationIdentity) {
  const runtimeIdentitySources = {
    sessionId: sys?.sessionId,
    parentSessionId: sys?.parentSessionId,
    dialogProcessId: sys?.dialogProcessId,
    turnScopeId: sys?.turnScopeId,
    runId: runtime?.runId,
  };
  for (const [field, rawValue] of Object.entries(runtimeIdentitySources)) {
    const runtimeValue = trimmedText(rawValue);
    if (runtimeValue && runtimeValue !== invocationIdentity[field]) {
      throw new Error(`runtime ${field} conflicts with agent context identity`);
    }
  }
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMessageBlocks(messageBlocks) {
  if (!messageBlocks || typeof messageBlocks !== "object") {
    return { system: [], history: [], incremental: [] };
  }
  return {
    system: arrayOrEmpty(messageBlocks.system),
    history: arrayOrEmpty(messageBlocks.history),
    incremental: arrayOrEmpty(messageBlocks.incremental),
  };
}

function applySelectedModel(modelState, agentContext, selectedModelSpec) {
  modelState.agentContext = agentContext;
  modelState.activeModelName = selectedModelSpec?.model || "";
  modelState.activeModelAlias = selectedModelSpec?.alias || "";
  modelState.activeModelSpec = selectedModelSpec;
}

function createAgentModelContext({
  runtime,
  context,
  eventListener,
  messages,
  messageBlocks,
  activeTurnIdentity,
}) {
  const modelContext = createModelContext({
    messages,
    activeTurnIdentity,
    checkpointRevision: Math.max(0, Number(runtime.summaryCheckpointRevision) || 0),
    onCanonicalMessageAdded(message, meta) {
      emitContextIdentityDebug(
        eventListener,
        "canonicalMessageAdded",
        activeTurnIdentity,
        canonicalMessageIdentityDebugData(message, meta),
      );
    },
    onMutationConsumed(result) {
      emitAgentContextProtocolDebug(
        eventListener,
        "mutationConsumed",
        { ...context.identity, ...activeTurnIdentity },
        {
          consumer: "agent-runtime",
          commandType: result.commandType,
          commandId: result.commandId,
          revision: result.revision,
        },
      );
    },
    messageBlocks: normalizeMessageBlocks(messageBlocks),
  });
  if (!modelContext) {
    throw new Error("agent state requires a versioned modelContext");
  }
  emitAgentContextProtocolDebug(eventListener, "documentCreated", context.identity, {
    consumer: "agent-state-builder",
    revision: 0,
    blockCounts: Object.fromEntries(
      Object.entries(modelContext.messageBlocks).map(([name, blockMessages]) => [
        name,
        blockMessages.length,
      ]),
    ),
    messageCount: modelContext.messages.length,
  });
  return modelContext;
}

function buildLoopState({
  tools,
  modelContext,
  runtime,
  sys,
  activeTurnIdentity,
  loopConfig,
  errorLogger,
}) {
  const { maxToolLoopTurns } = loopConfig;
  return {
    tools,
    modelContext,
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: runtime.currentTurnMessages || null,
    currentTurnTasks: runtime.currentTurnTasks || null,
    dialogProcessId: activeTurnIdentity.dialogProcessId,
    maxTurns:
      Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
        ? maxToolLoopTurns
        : DEFAULT_MAX_TOOL_LOOP_TURNS,
    phaseSummaryLoopTurns: loopConfig.phaseSummaryLoopTurns,
    taskCheckLoopTurns: loopConfig.taskCheckLoopTurns,
    phaseSummaryMessageCharsThreshold: loopConfig.phaseSummaryMessageCharsThreshold,
    helpPromptLoopTurns: loopConfig.helpPromptLoopTurns,
    toolFailureHelpCount: loopConfig.toolFailureHelpCount,
    taskSummaryTriggered: false,
    toolConsecutiveFailureCount: Number(sys?.toolConsecutiveFailureCount || 0),
    systemRuntime: sys,
    errorLogger,
  };
}

function recordModelContextOnRuntime(runtime, context, sys, activeTurnIdentity, modelContext) {
  runtime.activeMessageContext = modelContext;
  runtime.stoppedModelMessageSnapshotCandidate = {
    userId: context.identity.userId,
    sessionId: context.identity.sessionId,
    parentSessionId: context.identity.parentSessionId,
    ...activeTurnIdentity,
    messages: modelContext.messages,
    messageBlocks: modelContext.messageBlocks,
    userMetaBackwrites: arrayOrEmpty(modelContext.userMetaBackwrites),
    systemRuntime: sys,
  };
  return runtime.stoppedModelMessageSnapshotCandidate;
}

function emitAgentStateDiagnostics({
  runtime,
  context,
  eventListener,
  currentUserMessage,
  activeTurnIdentity,
  modelContext,
  identity,
}) {
  const sourceMessageUid = trimmedText(currentUserMessage?.messageUid);
  const userMetaId = `${sourceMessageUid}::user_meta`;
  const modelMessageIds = modelContext.messages.map(canonicalMessageId).filter(Boolean);
  emitContextIdentityDebug(eventListener, "modelContextCreated", identity, {
    sourceMessageUid,
    contentProjectionFound: modelMessageIds.includes(sourceMessageUid),
    userMetaProjectionFound: modelMessageIds.includes(userMetaId),
    contentProjectionId: modelMessageIds.find((id) => id === sourceMessageUid) || "",
    userMetaProjectionId: modelMessageIds.find((id) => id === userMetaId) || "",
    messageCount: modelContext.messages.length,
    systemCount: modelContext.messageBlocks.system.length,
    historyCount: modelContext.messageBlocks.history.length,
    incrementalCount: modelContext.messageBlocks.incremental.length,
  });
  emitContextIdentityDebug(eventListener, "snapshotCandidateCreated", identity, {
    sourceMessageUid,
    currentProjectionFound: modelMessageIds.includes(sourceMessageUid),
    messageCount: modelMessageIds.length,
    messageIds: modelMessageIds.slice(-12),
    truncatedMessageIdCount: Math.max(0, modelMessageIds.length - 12),
  });
  emitModelContextTrace(runtime, "agent_state_built", {
    dialogProcessId: activeTurnIdentity.dialogProcessId,
    payloadMessages: {
      systemCount: context.modelContext.messageBlocks.system.length,
      historyCount: context.modelContext.messageBlocks.history.length,
    },
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
  });
}

export function createStateBuilder({
  mergeConfigFn = mergeConfig,
  emitEventFn = emitEvent,
  buildContextMessagesFn = buildContextMessages,
  buildContextMessageBlocksFn = buildContextMessageBlocks,
  normalizeSystemRuntimeCountersFn = normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpecFn = resolveEffectiveModelSpec,
  resolveMaxToolLoopTurnsFn = resolveMaxToolLoopTurns,
  resolvePhaseSummaryLoopTurnsFn = resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurnsFn = resolveTaskCheckLoopTurns,
  resolvePhaseSummaryMessageCharsThresholdFn = resolvePhaseSummaryMessageCharsThreshold,
  resolveHelpPromptLoopTurnsFn = resolveHelpPromptLoopTurns,
  resolveToolFailureHelpCountFn = resolveToolFailureHelpCount,
} = {}) {
  const loopResolvers = {
    resolveMaxToolLoopTurnsFn,
    resolvePhaseSummaryLoopTurnsFn,
    resolveTaskCheckLoopTurnsFn,
    resolvePhaseSummaryMessageCharsThresholdFn,
    resolveHelpPromptLoopTurnsFn,
    resolveToolFailureHelpCountFn,
  };
  return function buildAgentState({ agentContext, currentUserMessage, errorLogger }) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const context = getAgentContextEnvelope(agentContext);
    const sys = getSystemRuntimeFromRuntime(runtime);
    const effectiveConfig = mergeConfigFn(runtime.globalConfig || {}, runtime.userConfig || {});
    const eventListener = runtime.eventListener || null;
    const tools = getToolsFromAgentContext(agentContext);

    normalizeSystemRuntimeCountersFn(sys, currentUserMessage.content);
    const loopConfig = resolveLoopConfig(
      loopResolvers,
      sys,
      effectiveConfig,
      runtime.runConfig || {},
    );

    const messageBlocks = buildContextMessageBlocksFn(agentContext, { currentUserMessage });
    const messages = Array.isArray(messageBlocks?.messages)
      ? messageBlocks.messages
      : buildContextMessagesFn(agentContext, { currentUserMessage });

    const { activeTurnIdentity, contextIdentity } = resolveActiveTurnIdentity(
      currentUserMessage,
      context,
    );
    const invocationIdentity = resolveInvocationIdentity(contextIdentity, activeTurnIdentity);
    assertRuntimeIdentityConsistent(runtime, sys, invocationIdentity);

    const modelHost = initializeAgentModelHost({
      runtime,
      invocationIdentity,
      resolveModelSpec: resolveEffectiveModelSpecFn,
    });
    const modelState = modelHost.modelState;
    applySelectedModel(modelState, agentContext, modelHost.modelSpec);

    const modelContext = createAgentModelContext({
      runtime,
      context,
      eventListener,
      messages,
      messageBlocks,
      activeTurnIdentity,
    });
    const loopState = buildLoopState({
      tools,
      modelContext,
      runtime,
      sys,
      activeTurnIdentity,
      loopConfig,
      errorLogger,
    });
    const identity = recordModelContextOnRuntime(
      runtime,
      context,
      sys,
      activeTurnIdentity,
      modelContext,
    );
    emitAgentStateDiagnostics({
      runtime,
      context,
      eventListener,
      currentUserMessage,
      activeTurnIdentity,
      modelContext,
      identity,
    });

    return { modelState, loopState };
  };
}

export const buildAgentState = createStateBuilder();
