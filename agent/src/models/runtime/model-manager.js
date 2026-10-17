/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent, hasEventListener } from "../../events/index.js";
import { emitMessageEvent } from "../../events/message-event-stream.js";
import { createLlmDeltaVisibilityFilter } from "../../events/llm-filter.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { resolveModelSpecByName } from "../index.js";
import { text } from "@noobot/shared/value";

function updateModelState(modelState, spec, shouldSwitch) {
  modelState.activeModelName = text(spec.model);
  modelState.activeModelAlias = text(spec?.alias);
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
  const runtimeModel = text(runtime?.runtimeModel);

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
    modelAlias: text(modelState?.activeModelAlias),
    modelName: text(modelState?.activeModelName),
  };
}

export function createStreamingCallbacks(eventListener = null, runtime = {}) {
  if (!hasEventListener(eventListener)) return undefined;
  const visibilityFilter = createLlmDeltaVisibilityFilter();
  const emitVisibleDelta = (value = "") => {
    const inputText = String(value || "");
    if (!inputText) return null;
    return emitMessageEvent(eventListener, runtime, "llm_delta", { text: inputText });
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
  if (!hasEventListener(eventListener)) {
    return { callbacks: undefined, complete: async () => null };
  }
  const visibilityFilter = createLlmDeltaVisibilityFilter();
  const emitVisibleDelta = (value = "") => {
    const inputText = String(value || "");
    if (!inputText) return null;
    return emitMessageEvent(eventListener, runtime, MESSAGE_EVENT_TYPE.ACTIVITY_DELTA, {
      ...activity,
      activityEventType,
      text: inputText,
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
      const normalizedText = text(finalText);
      if (!normalizedText) return null;
      return emitMessageEvent(eventListener, runtime, activityEventType, {
        ...activity,
        text: normalizedText,
      });
    },
  };
}
