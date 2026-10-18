/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_THRESHOLDS } from "../config/index.js";
import { buildContextMessageBlocks } from "../context/assembly/message-builder.js";
import {
  getAgentContextEnvelope,
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
  getToolsFromAgentContext,
} from "../context/agent-context-accessor.js";
import {
  normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpec,
  resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurns,
} from "./run-config/index.js";
import { createModelContext } from "@noobot/context-protocol/assembly/hook-context";
import { emitModelContextTrace } from "../observability/model-context-trace-emitter.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/assembly/diagnostics";
import {
  canonicalMessageIdentityDebugData,
  emitContextIdentityDebug,
} from "../observability/context-identity-debug.js";
import { emitAgentContextProtocolDebug } from "../observability/agent-context-protocol-debug.js";
import { initializeAgentModelHost } from "./model-port-host.js";
import { text, isObjectLike } from "@noobot/shared/value";

function trimmedText(value) {
  return text(value);
}

function resolveLoopConfig(resolvers, runConfig) {
  return {
    maxToolLoopTurns: BUILTIN_THRESHOLDS.maxToolLoopTurns,
    phaseSummaryLoopTurns: resolvers.resolvePhaseSummaryLoopTurnsFn({ runConfig }),
    taskCheckLoopTurns: resolvers.resolveTaskCheckLoopTurnsFn({ runConfig }),
    phaseSummaryMessageCharsThreshold:
      BUILTIN_THRESHOLDS.taskSummary.phaseSummaryMessageCharsThreshold,
    helpPromptLoopTurns: BUILTIN_THRESHOLDS.help.helpPromptLoopTurns,
    toolFailureHelpCount: BUILTIN_THRESHOLDS.help.toolFailureHelpCount,
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
  if (!isObjectLike(messageBlocks)) {
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
        canonicalMessageIdentityDebugData(message, meta),
      );
    },
    onMutationConsumed(result) {
      emitAgentContextProtocolDebug(eventListener, "mutationConsumed", {
        consumer: "agent-runtime",
        commandType: result.commandType,
        commandId: result.commandId,
        revision: result.revision,
      });
    },
    messageBlocks: normalizeMessageBlocks(messageBlocks),
  });
  if (!modelContext) {
    throw new Error("agent state requires a versioned modelContext");
  }
  emitAgentContextProtocolDebug(eventListener, "documentCreated", {
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
  return {
    tools,
    modelContext,
    traces: [],
    turnMessages: [],
    turnTasks: [],
    currentTurnMessages: runtime.currentTurnMessages || null,
    currentTurnTasks: runtime.currentTurnTasks || null,
    dialogProcessId: activeTurnIdentity.dialogProcessId,
    maxTurns: loopConfig.maxToolLoopTurns,
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
  modelContext,
}) {
  const sourceMessageUid = trimmedText(currentUserMessage?.messageUid);
  const userMetaId = `${sourceMessageUid}::user_meta`;
  const modelMessageIds = modelContext.messages.map(resolveContextMessageId).filter(Boolean);
  emitContextIdentityDebug(eventListener, "modelContextCreated", {
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
  emitContextIdentityDebug(eventListener, "snapshotCandidateCreated", {
    sourceMessageUid,
    currentProjectionFound: modelMessageIds.includes(sourceMessageUid),
    messageCount: modelMessageIds.length,
    messageIds: modelMessageIds.slice(-12),
    truncatedMessageIdCount: Math.max(0, modelMessageIds.length - 12),
  });
  emitModelContextTrace(runtime.eventListener, "agent_state_built", {
    payloadMessages: {
      systemCount: context.modelContext.messageBlocks.system.length,
      historyCount: context.modelContext.messageBlocks.history.length,
    },
    blocks: summarizeDiagnosticBlocks(modelContext.messageBlocks),
    messages: summarizeDiagnosticMessages(modelContext.messages),
  });
}

export function createStateBuilder({
  buildContextMessageBlocksFn = buildContextMessageBlocks,
  normalizeSystemRuntimeCountersFn = normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpecFn = resolveEffectiveModelSpec,
  resolvePhaseSummaryLoopTurnsFn = resolvePhaseSummaryLoopTurns,
  resolveTaskCheckLoopTurnsFn = resolveTaskCheckLoopTurns,
} = {}) {
  const loopResolvers = {
    resolvePhaseSummaryLoopTurnsFn,
    resolveTaskCheckLoopTurnsFn,
  };
  return function buildAgentState({ agentContext, currentUserMessage, errorLogger }) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const context = getAgentContextEnvelope(agentContext);
    const sys = getSystemRuntimeFromRuntime(runtime);
    const eventListener = runtime.eventListener || null;
    const tools = getToolsFromAgentContext(agentContext);

    normalizeSystemRuntimeCountersFn(sys, currentUserMessage.content);
    const loopConfig = resolveLoopConfig(loopResolvers, runtime.runConfig || {});

    const messageBlocks = buildContextMessageBlocksFn(agentContext, { currentUserMessage });
    const messages = messageBlocks.messages;

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
    recordModelContextOnRuntime(runtime, context, sys, activeTurnIdentity, modelContext);
    emitAgentStateDiagnostics({
      runtime,
      context,
      eventListener,
      currentUserMessage,
      modelContext,
    });

    return { modelState, loopState };
  };
}

export const buildAgentState = createStateBuilder();
import { resolveContextMessageId } from "@noobot/context-protocol/message/codec";
