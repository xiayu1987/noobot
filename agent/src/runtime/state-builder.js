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
import {
  CONTEXT_MESSAGE_PROJECTION_TYPE,
  composeContextProjectionKey,
  resolveContextMessageKey,
} from "@noobot/context-protocol/message/codec";
import { requireRuntimeModelHost } from "./model-port-host.js";
import { applyActiveModelSpec } from "../models/runtime/model-manager.js";

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

function resolveActiveTurnIdentity(currentUserMessage, identity) {
  for (const field of ["dialogProcessId", "turnScopeId"]) {
    if (currentUserMessage[field] !== identity[field]) {
      throw new Error(
        `current canonical user message ${field} conflicts with agent context identity`,
      );
    }
  }
  return { dialogProcessId: identity.dialogProcessId, turnScopeId: identity.turnScopeId };
}

const MODEL_HOST_IDENTITY_FIELDS = Object.freeze([
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
  "runId",
]);

function assertRuntimeIdentityConsistent(sys, identity) {
  for (const field of ["sessionId", "parentSessionId", "dialogProcessId", "turnScopeId"]) {
    if (sys[field] !== identity[field]) {
      throw new Error(`runtime ${field} conflicts with agent context identity`);
    }
  }
}

function requireTurnModelHost(runtime, identity) {
  const modelHost = requireRuntimeModelHost(runtime);
  for (const field of MODEL_HOST_IDENTITY_FIELDS) {
    if (modelHost.invocationIdentity[field] !== identity[field]) {
      throw new Error(`runtime model host ${field} conflicts with agent context identity`);
    }
  }
  return modelHost;
}

function createAgentModelContext({
  runtime,
  eventListener,
  messageBlocks,
  userMetaBackwrites,
  activeTurnIdentity,
}) {
  const modelContext = createModelContext({
    activeTurnIdentity,
    checkpointRevision: runtime.summaryCheckpointRevision,
    userMetaBackwrites,
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
    messageBlocks: {
      system: messageBlocks.system,
      history: messageBlocks.history,
      incremental: messageBlocks.incremental,
    },
  });
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

function buildLoopState({ tools, runtime, sys, loopConfig, errorLogger }) {
  return {
    tools,
    traces: [],
    currentTurnMessages: runtime.currentTurnMessages,
    currentTurnTasks: runtime.currentTurnTasks,
    maxTurns: loopConfig.maxToolLoopTurns,
    phaseSummaryLoopTurns: loopConfig.phaseSummaryLoopTurns,
    taskCheckLoopTurns: loopConfig.taskCheckLoopTurns,
    phaseSummaryMessageCharsThreshold: loopConfig.phaseSummaryMessageCharsThreshold,
    helpPromptLoopTurns: loopConfig.helpPromptLoopTurns,
    toolFailureHelpCount: loopConfig.toolFailureHelpCount,
    taskSummaryTriggered: false,
    systemRuntime: sys,
    errorLogger,
  };
}

function recordModelContextOnRuntime(runtime, context, activeTurnIdentity, modelContext) {
  runtime.activeMessageContext = modelContext;
  runtime.stoppedModelMessageSnapshotCandidate = {
    userId: context.identity.userId,
    sessionId: context.identity.sessionId,
    parentSessionId: context.identity.parentSessionId,
    ...activeTurnIdentity,
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
  const sourceMessageUid = currentUserMessage.messageUid;
  const userMetaId = sourceMessageUid
    ? composeContextProjectionKey(CONTEXT_MESSAGE_PROJECTION_TYPE.USER_META, sourceMessageUid)
    : "";
  const modelMessageIds = modelContext.messages.map(resolveContextMessageKey);
  emitContextIdentityDebug(eventListener, "modelContextCreated", {
    sourceMessageUid,
    contentProjectionFound: modelMessageIds.includes(sourceMessageUid),
    userMetaProjectionFound: modelMessageIds.includes(userMetaId),
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

    const activeTurnIdentity = resolveActiveTurnIdentity(currentUserMessage, context.identity);
    assertRuntimeIdentityConsistent(sys, context.identity);

    const modelHost = requireTurnModelHost(runtime, context.identity);
    const { modelState } = modelHost;
    modelState.agentContext = agentContext;
    applyActiveModelSpec(modelState, modelHost.modelSpec, { source: "turn_state" });

    const modelContext = createAgentModelContext({
      runtime,
      eventListener,
      messageBlocks,
      userMetaBackwrites: context.modelContext.userMetaBackwrites,
      activeTurnIdentity,
    });
    const loopState = buildLoopState({
      tools,
      runtime,
      sys,
      loopConfig,
      errorLogger,
    });
    recordModelContextOnRuntime(runtime, context, activeTurnIdentity, modelContext);
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
