/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ModelProtocolError, MODEL_ERROR_KIND } from "@noobot/model-protocol";
import { createResponsesFailureError } from "./openai-error-classification.js";
import {
  validatedModelResponseTerminal,
  validatedModelStreamTerminal,
} from "../normalization/response-terminal.js";

const INCOMPLETE_KINDS = new Map([
  ["max_output_tokens", MODEL_ERROR_KIND.OUTPUT_LIMIT],
  ["content_filter", MODEL_ERROR_KIND.CONTENT_POLICY],
]);

function createResponsesFailure(response, incomplete) {
  if (incomplete) {
    return new ModelProtocolError("Responses response ended incomplete", {
      kind: INCOMPLETE_KINDS.get(response?.incomplete_details?.reason) ?? MODEL_ERROR_KIND.PROTOCOL,
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
  if (validatedModelResponseTerminal("responses", response).status === "failed")
    throw createResponsesFailure(response, response.status === "incomplete");
  return response;
}

export async function* guardResponsesStream(stream) {
  for await (const event of stream) {
    const terminal = validatedModelStreamTerminal("responses", event);
    if (terminal?.status === "failed")
      throw createResponsesFailure(event.response, event.type === "response.incomplete");
    yield event;
    if (terminal) return;
  }
}

export async function collectResponsesStream(stream) {
  for await (const event of guardResponsesStream(stream)) {
    if (validatedModelStreamTerminal("responses", event)?.status === "completed")
      return event.response;
  }
  throw new ModelProtocolError("Responses stream ended without a terminal event");
}
