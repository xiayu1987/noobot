/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * LLM adapter for invocation and streaming fallback helpers.
 */
import { emitEvent } from "../../event/index.js";
import { createChatModel, createChatModelByName } from "../factory/chat-model.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

const STREAMING_TOOL_CALL_MISMATCH_THRESHOLD =
  TURN_THRESHOLDS.agent.streamingToolCallMismatchThreshold;

/**
 * Get or create a cached non-streaming LLM instance.
 * @param {object} modelState
 * @returns {object}
 */
function getNonStreamingInvokeLlm(modelState = {}) {
  const preferredModel =
    String(modelState?.activeModelAlias || "").trim() ||
    String(modelState?.activeModelName || "").trim();
  const cacheKey = preferredModel || "__default__";
  const cached = modelState?.__invokeLlmNonStreamingCache || null;
  if (cached?.key === cacheKey && cached?.llm) {
    return cached.llm;
  }

  const llm = preferredModel
    ? createChatModelByName(preferredModel, {
        globalConfig: modelState?.globalConfig || {},
        userConfig: modelState?.userConfig || {},
        streaming: false,
        context: {
          runtime: modelState?.runtime || {},
          agentContext: modelState?.agentContext || null,
          sessionId: String(
            modelState?.runtime?.systemRuntime?.sessionId || modelState?.runtime?.sessionId || "",
          ).trim(),
        },
      })
    : createChatModel({
        globalConfig: modelState?.globalConfig || {},
        userConfig: modelState?.userConfig || {},
        streaming: false,
        context: {
          runtime: modelState?.runtime || {},
          agentContext: modelState?.agentContext || null,
          sessionId: String(
            modelState?.runtime?.systemRuntime?.sessionId || modelState?.runtime?.sessionId || "",
          ).trim(),
        },
      });

  modelState.__invokeLlmNonStreamingCache = { key: cacheKey, llm };
  return llm;
}

function resolveFinishReason(ai = {}) {
  const candidates = [
    ai?.response_metadata?.finish_reason,
    ai?.response_metadata?.finishReason,
    ai?.additional_kwargs?.finish_reason,
    ai?.additional_kwargs?.finishReason,
    ai?.finish_reason,
    ai?.finishReason,
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim().toLowerCase();
    if (normalized) return normalized;
  }
  return "";
}

export function shouldRetryToolCallStreamingMismatch({ ai = {}, calls = [] } = {}) {
  if (Array.isArray(calls) && calls.length) return false;
  return resolveFinishReason(ai) === "tool_calls";
}

export function registerToolCallStreamingMismatch(modelState = {}, { mode = "", reason = "" } = {}) {
  const currentCount = Number(modelState?.__toolCallStreamingMismatchCount || 0);
  const nextCount = Number.isFinite(currentCount) ? currentCount + 1 : 1;
  modelState.__toolCallStreamingMismatchCount = nextCount;
  emitEvent(modelState?.eventListener, "llm_tool_call_streaming_mismatch_detected", {
    mode,
    reason: String(reason || "").trim(),
    mismatchCount: nextCount,
    forceNonStreamingFromNow: nextCount >= STREAMING_TOOL_CALL_MISMATCH_THRESHOLD,
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
  });
  return nextCount;
}

function shouldForceNonStreamingByMismatchBudget(modelState = {}) {
  const mismatchCount = Number(modelState?.__toolCallStreamingMismatchCount || 0);
  return Number.isFinite(mismatchCount) && mismatchCount >= STREAMING_TOOL_CALL_MISMATCH_THRESHOLD;
}

export function resolveRetryInvokeLlm(modelState = {}, { mode = "", reason = "" } = {}) {
  const nonStreamingLlm = getNonStreamingInvokeLlm(modelState);
  emitEvent(modelState?.eventListener, "llm_streaming_retry_downgraded_to_non_streaming", {
    mode,
    reason: String(reason || "").trim(),
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
  });
  return nonStreamingLlm;
}

/**
 * Resolve the LLM instance to use for invocation.
 * Default keeps streaming behavior for all models.
 * @param {object} modelState
 * @param {string} mode
 * @returns {object}
 */
export function resolveInvokeLlm(modelState = {}, mode = "") {
  if (shouldForceNonStreamingByMismatchBudget(modelState)) {
    const nonStreamingLlm = getNonStreamingInvokeLlm(modelState);
    if (modelState.__streamingDisabledByMismatchLogged !== true) {
      emitEvent(modelState?.eventListener, "llm_streaming_disabled_after_repeated_tool_call_mismatch", {
        mode,
        mismatchCount: Number(modelState?.__toolCallStreamingMismatchCount || 0),
        threshold: STREAMING_TOOL_CALL_MISMATCH_THRESHOLD,
        modelAlias: String(modelState?.activeModelAlias || "").trim(),
        modelName: String(modelState?.activeModelName || "").trim(),
      });
      modelState.__streamingDisabledByMismatchLogged = true;
    }
    return nonStreamingLlm;
  }
  return modelState.llm;
}
