/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { requireCapabilityActivity } from "@noobot/plugin-protocol";
import { MESSAGE_EVENT_TYPE } from "@noobot/event-protocol/message-event";
import { createModelActivity } from "../../models/runtime/model-manager.js";
import { requireRuntimeModelHost } from "../model-port-host.js";

export function createCapabilityModelStep({
  runtime,
  model,
  identity,
  signal,
  activity,
  metadata,
}) {
  const { modelPort } = requireRuntimeModelHost(runtime);
  const presentation = requireCapabilityActivity(activity);
  const streaming = runtime?.runConfig?.streaming === true;
  return async function invokeStep(messages, binding = null) {
    const modelActivity =
      presentation &&
      createModelActivity(runtime.eventListener, runtime, {
        ...metadata,
        ...presentation,
        activityId: randomUUID(),
        activityEventType: MESSAGE_EVENT_TYPE.THINKING,
        streaming,
      });
    const response = await modelPort.invoke({
      model,
      messages,
      ...(binding ? { tools: binding.tools } : {}),
      options: {
        streaming,
        signal,
        headers: identity.headers,
        ...(binding ? { toolBinding: binding.options } : {}),
        callbacks: modelActivity ? modelActivity.callbacks : undefined,
      },
      invocation: identity.invocation,
    });
    return {
      response,
      async complete() {
        if (!modelActivity) return response;
        const text = response.output.text.trim();
        if (!text) throw new Error("capability activity response is missing canonical output");
        await modelActivity.complete(text);
        return response;
      },
    };
  };
}
