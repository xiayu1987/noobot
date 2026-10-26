/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { emitEvent, hasEventListener } from "../../events/index.js";
import {
  appendAssistantDraftContent,
  emitMessageEvent,
} from "../../events/message-event-stream.js";
import { createLlmDeltaVisibilityFilter } from "../../events/llm-filter.js";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { resolveModelSpecByName } from "../index.js";
import { isPlainObject, text } from "@noobot/shared/value";

function requireResolvedModelSpec(spec, source) {
  if (!isPlainObject(spec) || !text(spec.model)) {
    throw new TypeError(`model spec not resolved: ${source}`);
  }
  return spec;
}

export function applyActiveModelSpec(modelState, spec, { source }) {
  const resolvedSpec = requireResolvedModelSpec(spec, source);
  modelState.activeModelSpec = resolvedSpec;
  return resolvedSpec;
}

export function resolveLlmForTurn(modelState) {
  const { runtime, defaultModelSpec } = modelState;
  const runtimeModel = text(runtime.runtimeModel);
  const targetSpec = runtimeModel
    ? requireResolvedModelSpec(
        resolveModelSpecByName({
          modelName: runtimeModel,
          globalConfig: runtime.globalConfig,
          userConfig: runtime.userConfig,
        }),
        `runtimeModel ${runtimeModel}`,
      )
    : requireResolvedModelSpec(defaultModelSpec, "defaultModelSpec");
  if (targetSpec.model === modelState.activeModelSpec.model) return;
  applyActiveModelSpec(modelState, targetSpec, { source: "turn" });
  emitEvent(runtime.eventListener, "model_switched", {
    alias: targetSpec.alias,
    model: targetSpec.model,
  });
}

export function createStreamingCallbacks(eventListener, runtime) {
  if (!hasEventListener(eventListener)) return undefined;
  const visibilityFilter = createLlmDeltaVisibilityFilter();
  const emitVisibleDelta = (visibleText) => {
    if (!visibleText) return null;
    appendAssistantDraftContent(runtime, visibleText);
    return emitMessageEvent(eventListener, runtime, "llm_delta", { text: visibleText });
  };
  return [
    {
      handleLLMNewToken: (token) => emitVisibleDelta(visibilityFilter.push(token)),
      handleLLMEnd: () => emitVisibleDelta(visibilityFilter.flush()),
    },
  ];
}

export function createModelActivity(
  eventListener,
  runtime,
  {
    activityKind,
    activityEventType,
    purpose,
    pluginFlow,
    chain,
    relayCorrelationId,
    activityId = randomUUID(),
    streaming,
  },
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
  const emitVisibleDelta = (inputText) => {
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
            handleLLMNewToken: (token) => emitVisibleDelta(visibilityFilter.push(token)),
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
