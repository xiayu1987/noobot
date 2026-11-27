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
import {
  capturePatchReadVersions,
  bindPatchReadVersions,
} from "../tool-execution/patch-read-context.js";

export function createCapabilityModelStep({
  runtime,
  model,
  identity,
  signal,
  activity,
  metadata,
  streaming,
  streamingRequired,
}) {
  const { modelPort } = requireRuntimeModelHost(runtime);
  const presentation = requireCapabilityActivity(activity);
  if (typeof streaming !== "boolean") throw new TypeError("capability streaming must be boolean");
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
    const readVersions = capturePatchReadVersions(messages);
    const response = await modelPort.invoke({
      model,
      messages,
      ...(binding ? { tools: binding.tools } : {}),
      options: {
        streaming,
        ...(streamingRequired !== undefined ? { streamingRequired } : {}),
        signal,
        headers: identity.headers,
        ...(binding ? { toolBinding: binding.options } : {}),
        callbacks: modelActivity ? modelActivity.callbacks : undefined,
      },
      invocation: identity.invocation,
    });
    const boundResponse = {
      ...response,
      output: bindPatchReadVersions(response.output, readVersions),
    };
    return {
      response: boundResponse,
      async complete() {
        if (!modelActivity) return boundResponse;
        const text = response.output.text.trim();
        if (!text) throw new Error("capability activity response is missing canonical output");
        await modelActivity.complete(text);
        return boundResponse;
      },
    };
  };
}
