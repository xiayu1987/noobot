/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ModelProtocolError,
  requireModelResponseTerminal,
  resolveModelStreamTerminal,
} from "@noobot/model-protocol";
import { createResponsesFailureError } from "./openai-error-classification.js";

function createResponsesFailure(response, incomplete) {
  if (incomplete) {
    return new ModelProtocolError("Responses response ended incomplete", {
      details: {
        responseId: response?.id,
        reason: response?.incomplete_details?.reason ?? null,
      },
    });
  }
  const upstream = response?.error;
  if (!upstream?.code || !upstream?.message) {
    return new ModelProtocolError("Responses failed response requires error code and message", {
      details: { responseId: response?.id },
    });
  }
  return createResponsesFailureError(upstream);
}

export function requireCompletedResponsesResponse(response) {
  if (requireModelResponseTerminal("responses", response).status === "failed")
    throw createResponsesFailure(response, response.status === "incomplete");
  return response;
}

export async function* guardResponsesStream(stream) {
  for await (const event of stream) {
    const terminal = resolveModelStreamTerminal("responses", event);
    if (terminal?.status === "failed")
      throw createResponsesFailure(event.response, event.type === "response.incomplete");
    yield event;
    if (terminal) return;
  }
}

export async function collectResponsesStream(stream) {
  for await (const event of guardResponsesStream(stream)) {
    if (resolveModelStreamTerminal("responses", event)?.status === "completed")
      return event.response;
  }
  throw new ModelProtocolError("Responses stream ended without a terminal event");
}
