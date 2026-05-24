/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createChatModel } from "../../model/index.js";
import { mergeConfig } from "../../config/index.js";
import { emitEvent } from "../../event/index.js";
import { buildContextMessages } from "./context/message-builder.js";
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
  normalizeSystemRuntimeCountersFn = normalizeSystemRuntimeCounters,
  resolveEffectiveModelSpecFn = resolveEffectiveModelSpec,
  resolveMaxToolLoopTurnsFn = resolveMaxToolLoopTurns,
  resolvePhaseSummaryLoopTurnsFn = resolvePhaseSummaryLoopTurns,
  resolvePhaseSummaryMessageCharsThresholdFn = resolvePhaseSummaryMessageCharsThreshold,
  resolveHelpPromptLoopTurnsFn = resolveHelpPromptLoopTurns,
  resolveToolFailureHelpCountFn = resolveToolFailureHelpCount,
} = {}) {
  return function buildAgentState({ agentContext, userMessage, errorLogger }) {
    const runtime = agentContext?.execution?.controllers?.runtime || {};
    const sys = runtime.systemRuntime || {};
    const globalConfig = runtime.globalConfig || {};
    const userConfig = runtime.userConfig || {};
    const effectiveConfig = mergeConfigFn(globalConfig, userConfig);
    const eventListener = runtime.eventListener || null;
    const abortSignal = runtime.abortSignal || null;
    const dialogProcessId = sys.dialogProcessId || "";
    const tools = Array.isArray(agentContext?.payload?.tools?.registry)
      ? agentContext.payload.tools.registry
      : [];

    normalizeSystemRuntimeCountersFn(runtime.systemRuntime, userMessage);

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
      streaming: Boolean(eventListener?.onEvent),
    });
    emitEventFn(eventListener, "model_selected", {
      alias: selectedModelSpec?.alias || "",
      model: selectedModelSpec?.model || "",
    });

    const messages = buildContextMessagesFn(agentContext, {
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
      toolConsecutiveFailureCount: Number(
        runtime?.systemRuntime?.toolConsecutiveFailureCount || 0,
      ),
      errorLogger,
    };

    return { modelState, loopState };
  };
}

export const buildAgentState = createStateBuilder();
