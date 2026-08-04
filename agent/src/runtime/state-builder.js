/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModel } from "../models/index.js";
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
  resolveToolFailureHelpCount,
} from "./run-config/index.js";
import { createModelContext } from "@noobot/context-protocol/hook-context";
import { emitModelContextTrace } from "../observability/model-context-trace-emitter.js";
import {
  summarizeDiagnosticBlocks,
  summarizeDiagnosticMessages,
} from "@noobot/context-protocol/context-diagnostics";
import {
  canonicalMessageId,
  canonicalMessageIdentityDebugData,
  emitContextIdentityDebug,
} from "../observability/context-identity-debug.js";
import { emitAgentContextProtocolDebug } from "../observability/agent-context-protocol-debug.js";

export function createStateBuilder({
  createChatModelFn = createChatModel,
  mergeConfigFn = mergeConfig,
  emitEventFn = emitEvent,
  buildContextMessagesFn = buildContextMessages,
  buildContextMessageBlocksFn = buildContextMessageBlocks,
  normalizeSystemRuntimeCountersFn = normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpecFn = resolveEffectiveModelSpec,
  resolveMaxToolLoopTurnsFn = resolveMaxToolLoopTurns,
  resolvePhaseSummaryLoopTurnsFn = resolvePhaseSummaryLoopTurns,
  resolvePhaseSummaryMessageCharsThresholdFn = resolvePhaseSummaryMessageCharsThreshold,
  resolveHelpPromptLoopTurnsFn = resolveHelpPromptLoopTurns,
  resolveToolFailureHelpCountFn = resolveToolFailureHelpCount,
} = {}) {
  return function buildAgentState({ agentContext, currentUserMessage, errorLogger }) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const context = getAgentContextEnvelope(agentContext);
    const sys = getSystemRuntimeFromRuntime(runtime);
    const globalConfig = runtime.globalConfig || {};
    const userConfig = runtime.userConfig || {};
    const effectiveConfig = mergeConfigFn(globalConfig, userConfig);
    const eventListener = runtime.eventListener || null;
    const abortSignal = runtime.abortSignal || null;
    const dialogProcessId = context.identity.dialogProcessId;
    const tools = getToolsFromAgentContext(agentContext);

    normalizeSystemRuntimeCountersFn(sys, currentUserMessage.content);

    const runConfig = runtime?.runConfig || {};
    const selectedModelSpec = resolveEffectiveModelSpecFn({
      globalConfig,
      userConfig,
      selectedModel: runConfig.selectedModel,
      scenario: runConfig.scenario,
    });
    const maxToolLoopTurns = resolveMaxToolLoopTurnsFn({
      systemRuntime: sys,
      effectiveConfig,
    });
    const phaseSummaryLoopTurns = resolvePhaseSummaryLoopTurnsFn(effectiveConfig);
    const phaseSummaryMessageCharsThreshold =
      resolvePhaseSummaryMessageCharsThresholdFn(effectiveConfig);
    const helpPromptLoopTurns = resolveHelpPromptLoopTurnsFn(effectiveConfig);
    const toolFailureHelpCount = resolveToolFailureHelpCountFn(effectiveConfig);

    const llm = createChatModelFn(selectedModelSpec, {
      globalConfig,
      userConfig,
      streaming: false,
      context: {
        runtime,
        agentContext,
        sessionId: String(sys?.sessionId || runtime?.sessionId || "").trim(),
      },
    });
    emitEventFn(eventListener, "model_selected", {
      alias: selectedModelSpec?.alias || "",
      model: selectedModelSpec?.model || "",
    });

    const messageBlocks = buildContextMessageBlocksFn(agentContext, {
      currentUserMessage,
    });
    const messages = Array.isArray(messageBlocks?.messages)
      ? messageBlocks.messages
      : buildContextMessagesFn(agentContext, {
          currentUserMessage,
        });

    const modelState = {
      agentContext,
      llm,
      activeModelName: selectedModelSpec?.model || "",
      activeModelAlias: selectedModelSpec?.alias || "",
      eventListener,
      runtime,
      globalConfig,
      userConfig,
      defaultModelSpec: selectedModelSpec,
      abortSignal,
    };

    const activeTurnIdentity = {
      dialogProcessId: String(currentUserMessage?.dialogProcessId || "").trim(),
      turnScopeId: String(currentUserMessage?.turnScopeId || "").trim(),
    };
    if (!activeTurnIdentity.dialogProcessId || !activeTurnIdentity.turnScopeId) {
      throw new Error("current canonical user message requires dialogProcessId and turnScopeId");
    }
    const runtimeDialogProcessId = String(dialogProcessId || sys?.dialogProcessId || "").trim();
    const runtimeTurnScopeId = String(
      runConfig?.turnScopeId || sys?.turnScopeId || sys?.config?.turnScopeId || "",
    ).trim();
    if (runtimeDialogProcessId && runtimeDialogProcessId !== activeTurnIdentity.dialogProcessId) {
      throw new Error("current canonical user message dialogProcessId conflicts with runtime identity");
    }
    if (runtimeTurnScopeId && runtimeTurnScopeId !== activeTurnIdentity.turnScopeId) {
      throw new Error("current canonical user message turnScopeId conflicts with runtime identity");
    }
    const modelContext = createModelContext({
      messages,
      activeTurnIdentity,
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
      messageBlocks:
        messageBlocks && typeof messageBlocks === "object"
          ? {
              system: Array.isArray(messageBlocks.system) ? messageBlocks.system : [],
              history: Array.isArray(messageBlocks.history) ? messageBlocks.history : [],
              incremental: Array.isArray(messageBlocks.incremental)
                ? messageBlocks.incremental
                : [],
            }
          : { system: [], history: [], incremental: [] },
    });
    if (!modelContext) {
      throw new Error("agent state requires a versioned modelContext");
    }
    emitAgentContextProtocolDebug(eventListener, "documentCreated", context.identity, {
      consumer: "agent-state-builder",
      revision: 0,
      blockCounts: Object.fromEntries(
        Object.entries(modelContext.messageBlocks).map(([name, blockMessages]) => [name, blockMessages.length]),
      ),
      messageCount: modelContext.messages.length,
    });

    const loopState = {
      tools,
      modelContext,
      traces: [],
      turnMessages: [],
      turnTasks: [],
      currentTurnMessages: runtime?.currentTurnMessages || null,
      currentTurnTasks: runtime?.currentTurnTasks || null,
      dialogProcessId: activeTurnIdentity.dialogProcessId,
      maxTurns:
        Number.isFinite(maxToolLoopTurns) && maxToolLoopTurns > 0
          ? maxToolLoopTurns
          : DEFAULT_MAX_TOOL_LOOP_TURNS,
      phaseSummaryLoopTurns,
      phaseSummaryMessageCharsThreshold,
      helpPromptLoopTurns,
      toolFailureHelpCount,
      taskSummaryTriggered: false,
      toolConsecutiveFailureCount: Number(sys?.toolConsecutiveFailureCount || 0),
      errorLogger,
    };
    runtime.activeMessageContext = modelContext;
    runtime.stoppedModelMessageSnapshotCandidate = {
      userId: context.identity.userId,
      sessionId: context.identity.sessionId,
      parentSessionId: context.identity.parentSessionId,
      ...activeTurnIdentity,
      messages: modelContext.messages,
      messageBlocks: modelContext.messageBlocks,
    };
    const sourceMessageUid = String(currentUserMessage?.messageUid || "").trim();
    const modelMessageIds = modelContext.messages.map(canonicalMessageId).filter(Boolean);
    const identity = runtime.stoppedModelMessageSnapshotCandidate;
    emitContextIdentityDebug(eventListener, "modelContextCreated", identity, {
      sourceMessageUid,
      contentProjectionFound: modelMessageIds.includes(sourceMessageUid),
      userMetaProjectionFound: modelMessageIds.includes(`${sourceMessageUid}::user_meta`),
      contentProjectionId: modelMessageIds.find((id) => id === sourceMessageUid) || "",
      userMetaProjectionId: modelMessageIds.find((id) => id === `${sourceMessageUid}::user_meta`) || "",
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

    return { modelState, loopState };
  };
}

export const buildAgentState = createStateBuilder();
