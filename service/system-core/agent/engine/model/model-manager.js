/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import {
  createChatModel,
  createChatModelByName,
  resolveModelSpecByName,
} from "../../../model/index.js";

export function resolveLlmForTurn(modelState) {
  const { runtime, globalConfig, userConfig, defaultModelSpec, eventListener } =
    modelState;
  const runtimeModel = String(runtime?.runtimeModel || "").trim();

  if (runtimeModel) {
    const runtimeSpec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (
      runtimeSpec?.model &&
      runtimeSpec.model !== modelState.activeModelName
    ) {
      modelState.llm = createChatModelByName(runtimeModel, {
        globalConfig,
        userConfig,
        streaming: Boolean(eventListener?.onEvent),
      });
      modelState.activeModelName = runtimeSpec.model;
      modelState.activeModelAlias = String(runtimeSpec?.alias || "").trim();
      emitEvent(eventListener, "model_switched", {
        alias: runtimeSpec?.alias || "",
        model: runtimeSpec?.model || "",
      });
    } else if (runtimeSpec?.model) {
      modelState.activeModelName = String(runtimeSpec.model || "").trim();
      modelState.activeModelAlias = String(runtimeSpec?.alias || "").trim();
    }
    return;
  }

  if (
    defaultModelSpec?.model &&
    defaultModelSpec.model !== modelState.activeModelName
  ) {
    modelState.llm = createChatModel({
      globalConfig,
      userConfig,
      streaming: Boolean(eventListener?.onEvent),
    });
    modelState.activeModelName = String(defaultModelSpec.model || "");
    modelState.activeModelAlias = String(defaultModelSpec?.alias || "").trim();
    emitEvent(eventListener, "model_switched", {
      alias: defaultModelSpec?.alias || "",
      model: defaultModelSpec?.model || "",
    });
  } else if (defaultModelSpec?.model) {
    modelState.activeModelName = String(defaultModelSpec.model || "").trim();
    modelState.activeModelAlias = String(defaultModelSpec?.alias || "").trim();
  }
}

export function resolveCurrentModelInfo(modelState = {}) {
  return {
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
  };
}

export function createStreamingCallbacks(eventListener = null) {
  if (!eventListener?.onEvent) return undefined;
  return [
    {
      handleLLMNewToken: (token) =>
        emitEvent(eventListener, "llm_delta", {
          text: String(token || ""),
        }),
    },
  ];
}
