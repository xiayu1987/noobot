/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ModelProtocolError } from "@noobot/model-protocol";
import { createResponsesFailureError } from "./openai-error-classification.js";

function createResponsesStreamFailure(event) {
  const upstream = event.response?.error;
  if (!upstream?.code || !upstream?.message) {
    return new ModelProtocolError(
      "Responses response.failed event requires error code and message",
      {
        details: { responseId: event.response?.id },
      },
    );
  }
  return createResponsesFailureError(upstream);
}

export async function* guardResponsesStream(stream) {
  for await (const event of stream) {
    if (event?.type === "response.failed") throw createResponsesStreamFailure(event);
    yield event;
  }
}

export async function collectResponsesStream(stream) {
  for await (const event of guardResponsesStream(stream)) {
    if (event?.type === "response.completed") return event.response;
    if (event?.type === "response.incomplete") {
      throw new ModelProtocolError("Responses stream ended incomplete", {
        details: {
          responseId: event.response?.id,
          reason: event.response?.incomplete_details?.reason ?? null,
        },
      });
    }
  }
  throw new ModelProtocolError("Responses stream ended without a terminal event");
}
