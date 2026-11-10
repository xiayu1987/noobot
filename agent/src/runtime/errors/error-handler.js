/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { resolveErrorDetails, resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { classifyEngineError } from "./error-classifier.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortReason,
} from "@noobot/session-protocol/execution-abort";
import { text } from "@noobot/shared/value";

export function buildEngineErrorPayload({ error, abortSignal = null, metadata = {} } = {}) {
  const normalizedClassification = classifyEngineError(error, abortSignal);
  const details = resolveErrorDetails(error);
  const abortReason = resolveExecutionAbortReason({ error, abortSignal });
  const type = abortReason?.type ?? details.type;
  const name = text(error?.name || error?.cause?.name);
  const message =
    normalizedClassification === "abort"
      ? resolveExecutionAbortMessage({ error, abortSignal })
      : resolveErrorMessage(error);

  return {
    classification: normalizedClassification,
    message,
    ...metadata,
    error: {
      classification: normalizedClassification,
      name: name || undefined,
      message,
      ...details,
      type,
      source: text(metadata?.source) || undefined,
    },
  };
}

export function handleEngineError({
  error,
  abortSignal = null,
  eventListener = null,
  event = "agent_error",
  metadata = {},
} = {}) {
  const payload = buildEngineErrorPayload({ error, abortSignal, metadata });
  emitEvent(eventListener, event, payload);
  return {
    classification: payload.classification,
    error,
    payload,
  };
}
