/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModel } from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { emitEvent } from "../../event/index.js";
import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "./context/message-builder.js";
import { resolveDialogProcessId } from "../../context/session/dialog-process-id-resolver.js";
import {
  getRuntimeFromAgentContext,
  getSystemRuntimeFromRuntime,
} from "../../context/agent-context-accessor.js";
import { DEFAULT_MAX_TOOL_LOOP_TURNS } from "./constants/index.js";
import {
  normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpec,
  resolveHelpPromptLoopTurns,
  resolveMaxToolLoopTurns,
  resolvePhaseSummaryMessageCharsThreshold,
  resolvePhaseSummaryLoopTurns,
  resolveToolFailureHelpCount,
} from "./config/index.js";

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
  return function buildAgentState({ agentContext, userMessage, errorLogger }) {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const sys = getSystemRuntimeFromRuntime(runtime);
    const globalConfig = runtime.globalConfig || {};
    const userConfig = runtime.userConfig || {};
    const effectiveConfig = mergeConfigFn(globalConfig, userConfig);
    const eventListener = runtime.eventListener || null;
    const abortSignal = runtime.abortSignal || null;
    const dialogProcessId = resolveDialogProcessId({
      ctx: { runtime, systemRuntime: sys, agentContext },
      messages: agentContext?.payload?.messages?.history,
    });
    const tools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];

    normalizeSystemRuntimeCountersFn(sys, userMessage);

    const selectedModelSpec = resolveEffectiveModelSpecFn({ globalConfig, userConfig });
    const maxToolLoopTurns = resolveMaxToolLoopTurnsFn({
      systemRuntime: sys,
      effectiveConfig,
    });
    const phaseSummaryLoopTurns = resolvePhaseSummaryLoopTurnsFn(effectiveConfig);
    const phaseSummaryMessageCharsThreshold =
      resolvePhaseSummaryMessageCharsThresholdFn(effectiveConfig);
    const helpPromptLoopTurns = resolveHelpPromptLoopTurnsFn(effectiveConfig);
    const toolFailureHelpCount = resolveToolFailureHelpCountFn(effectiveConfig);

    const llm = createChatModelFn({
      globalConfig,
      userConfig,
      streaming: false,
    });
    emitEventFn(eventListener, "model_selected", {
      alias: selectedModelSpec?.alias || "",
      model: selectedModelSpec?.model || "",
    });

    const messageBlocks = buildContextMessageBlocksFn(agentContext, {
      currentUserMessage: userMessage,
    });
    const messages = Array.isArray(messageBlocks?.messages)
      ? messageBlocks.messages
      : buildContextMessagesFn(agentContext, {
          currentUserMessage: userMessage,
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

    const loopState = {
      tools,
      messages,
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
      traces: [],
      turnMessages: [],
      turnTasks: [],
      currentTurnMessages: runtime?.currentTurnMessages || null,
      currentTurnTasks: runtime?.currentTurnTasks || null,
      dialogProcessId,
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

    return { modelState, loopState };
  };
}

export const buildAgentState = createStateBuilder();
