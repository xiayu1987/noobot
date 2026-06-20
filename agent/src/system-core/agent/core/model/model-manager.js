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

function updateModelState(modelState, spec, shouldSwitch) {
  modelState.activeModelName = String(spec.model || "").trim();
  modelState.activeModelAlias = String(spec?.alias || "").trim();
  if (shouldSwitch) {
    emitEvent(modelState.eventListener, "model_switched", {
      alias: spec?.alias || "",
      model: spec?.model || "",
    });
  }
}

export function resolveLlmForTurn(modelState) {
  const { runtime, globalConfig, userConfig, defaultModelSpec, eventListener } =
    modelState;
  const runtimeModel = String(runtime?.runtimeModel || "").trim();

  let targetSpec = null;
  let shouldSwitch = false;

  if (runtimeModel) {
    targetSpec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
      fallbackToDefault: false,
    });
    if (targetSpec?.model && targetSpec.model !== modelState.activeModelName) {
      shouldSwitch = true;
    }
  } else if (defaultModelSpec?.model && defaultModelSpec.model !== modelState.activeModelName) {
    targetSpec = defaultModelSpec;
    shouldSwitch = true;
  } else if (defaultModelSpec?.model) {
    targetSpec = defaultModelSpec;
    shouldSwitch = false;
  }

  if (!targetSpec?.model) return;

  if (shouldSwitch) {
    modelState.llm = runtimeModel
      ? createChatModelByName(runtimeModel, {
          globalConfig,
          userConfig,
          streaming: false,
          context: {
            runtime,
            sessionId: String(runtime?.systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
          },
        })
      : createChatModel(targetSpec, {
          globalConfig,
          userConfig,
          streaming: false,
          context: {
            runtime,
            sessionId: String(runtime?.systemRuntime?.sessionId || runtime?.sessionId || "").trim(),
          },
        });
  }

  updateModelState(modelState, targetSpec, shouldSwitch);
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
