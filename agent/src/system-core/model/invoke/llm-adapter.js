/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * LLM adapter for invocation: Gemini non-streaming workaround with caching.
 */
import { emitEvent } from "../../event/index.js";
import { createChatModel, createChatModelByName } from "../factory/chat-model.js";

/**
 * Check if the active model is Gemini-like.
 * @param {object} modelState
 * @returns {boolean}
 */
function isGeminiLikeModel(modelState = {}) {
  const alias = String(modelState?.activeModelAlias || "").toLowerCase();
  const name = String(modelState?.activeModelName || "").toLowerCase();
  return `${alias} ${name}`.includes("gemini");
}

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
      })
    : createChatModel({
        globalConfig: modelState?.globalConfig || {},
        userConfig: modelState?.userConfig || {},
        streaming: false,
      });

  modelState.__invokeLlmNonStreamingCache = { key: cacheKey, llm };
  return llm;
}

/**
 * Resolve the LLM instance to use for invocation.
 * For Gemini models, returns a non-streaming instance with a one-time event.
 * @param {object} modelState
 * @param {string} mode
 * @returns {object}
 */
export function resolveInvokeLlm(modelState = {}, mode = "") {
  if (!isGeminiLikeModel(modelState)) return modelState.llm;
  const nonStreamingLlm = getNonStreamingInvokeLlm(modelState);
  if (modelState.__geminiStreamingDisableLogged !== true) {
    emitEvent(modelState?.eventListener, "llm_streaming_temporarily_disabled", {
      mode,
      modelAlias: String(modelState?.activeModelAlias || "").trim(),
      modelName: String(modelState?.activeModelName || "").trim(),
      reason: "gemini_stability_workaround",
    });
    modelState.__geminiStreamingDisableLogged = true;
  }
  return nonStreamingLlm;
}
