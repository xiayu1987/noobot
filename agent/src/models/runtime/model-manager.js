/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent } from "../../events/index.js";
import { emitMessageEvent } from "../../events/message-event-stream.js";
import { createLlmDeltaVisibilityFilter } from "../../events/llm-filter.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { resolveModelSpecByName } from "../index.js";

function updateModelState(modelState, spec, shouldSwitch) {
  modelState.activeModelName = String(spec.model || "").trim();
  modelState.activeModelAlias = String(spec?.alias || "").trim();
  modelState.activeModelSpec = spec && typeof spec === "object" ? { ...spec } : null;
  if (shouldSwitch) {
    emitEvent(modelState.eventListener, "model_switched", {
      alias: spec?.alias || "",
      model: spec?.model || "",
    });
  }
}

export function resolveLlmForTurn(modelState) {
  const { runtime, globalConfig, userConfig, defaultModelSpec } = modelState;
  const runtimeModel = String(runtime?.runtimeModel || "").trim();

  let targetSpec = null;
  let shouldSwitch = false;

  if (runtimeModel) {
    targetSpec = resolveModelSpecByName({
      modelName: runtimeModel,
      globalConfig,
      userConfig,
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

  updateModelState(modelState, targetSpec, shouldSwitch);
}

export function resolveCurrentModelInfo(modelState = {}) {
  return {
    modelAlias: String(modelState?.activeModelAlias || "").trim(),
    modelName: String(modelState?.activeModelName || "").trim(),
  };
}

export function createStreamingCallbacks(eventListener = null, runtime = {}) {
  if (!eventListener?.onEvent) return undefined;
  const visibilityFilter = createLlmDeltaVisibilityFilter();
  const emitVisibleDelta = (value = "") => {
    const text = String(value || "");
    if (!text) return null;
    return emitMessageEvent(eventListener, runtime, "llm_delta", { text });
  };
  return [
    {
      handleLLMNewToken: (token) => emitVisibleDelta(visibilityFilter.push(String(token || ""))),
      handleLLMEnd: () => emitVisibleDelta(visibilityFilter.flush()),
    },
  ];
}

export function createModelActivity(
  eventListener = null,
  runtime = {},
  {
    activityKind = "model_analysis",
    activityEventType = MESSAGE_EVENT_TYPE.THINKING,
    purpose = "",
    pluginFlow = "",
    chain = "",
    relayCorrelationId = "",
    activityId = randomUUID(),
    streaming = false,
  } = {},
) {
  const activity = {
    activityId,
    activityKind,
    purpose,
    pluginFlow,
    chain,
    relayCorrelationId,
  };
  if (!eventListener?.onEvent) {
    return { callbacks: undefined, complete: async () => null };
  }
  const visibilityFilter = createLlmDeltaVisibilityFilter();
  const emitVisibleDelta = (value = "") => {
    const text = String(value || "");
    if (!text) return null;
    return emitMessageEvent(eventListener, runtime, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA, {
      ...activity,
      activityEventType,
      text,
    });
  };
  return {
    callbacks: streaming
      ? [
          {
            handleLLMNewToken: (token) =>
              emitVisibleDelta(visibilityFilter.push(String(token || ""))),
            handleLLMEnd: () => emitVisibleDelta(visibilityFilter.flush()),
          },
        ]
      : undefined,
    async complete(finalText = "") {
      const text = String(finalText || "").trim();
      if (!text) return null;
      return emitMessageEvent(eventListener, runtime, activityEventType, { ...activity, text });
    },
  };
}
