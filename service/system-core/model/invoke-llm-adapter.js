/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../event/index.js";
import { createChatModel, createChatModelByName } from "./index.js";

function isGeminiLikeModel(modelState = {}) {
  const modelAlias = String(modelState?.activeModelAlias || "").toLowerCase();
  const modelName = String(modelState?.activeModelName || "").toLowerCase();
  const token = `${modelAlias} ${modelName}`;
  return token.includes("gemini");
}

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

  modelState.__invokeLlmNonStreamingCache = {
    key: cacheKey,
    llm,
  };
  return llm;
}

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

