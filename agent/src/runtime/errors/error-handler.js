/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../events/index.js";
import { resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { classifyEngineError } from "./error-classifier.js";
import {
  resolveExecutionAbortMessage,
  resolveExecutionAbortReason,
} from "@noobot/session-protocol/execution-abort";
import { resolveErrorHeaderValue } from "../../shared/utils/error-header.js";

function resolveErrorStatus(error = {}) {
  const rawStatus =
    error?.status ??
    error?.statusCode ??
    error?.error?.status ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode ??
    error?.cause?.error?.status;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : undefined;
}

function resolveRequestId(error = {}) {
  return (
    error?.request_id ??
    error?.requestId ??
    error?.requestID ??
    resolveErrorHeaderValue(error?.headers, "x-request-id") ??
    resolveErrorHeaderValue(error?.response?.headers, "x-request-id") ??
    resolveErrorHeaderValue(error?.cause?.headers, "x-request-id") ??
    resolveErrorHeaderValue(error?.cause?.response?.headers, "x-request-id") ??
    undefined
  );
}

export function buildEngineErrorPayload({
  error,
  abortSignal = null,
  classification,
  metadata = {},
} = {}) {
  const normalizedClassification = classification || classifyEngineError(error);
  const status = resolveErrorStatus(error);
  const code =
    error?.code ??
    error?.error?.code ??
    error?.cause?.code ??
    error?.cause?.error?.code ??
    undefined;
  const abortReason = resolveExecutionAbortReason({ error, abortSignal });
  const type =
    abortReason?.type ??
    error?.type ??
    error?.error?.type ??
    error?.cause?.type ??
    error?.cause?.error?.type ??
    undefined;
  const name = String(error?.name || error?.cause?.name || "").trim();
  const message =
    normalizedClassification === "abort"
      ? resolveExecutionAbortMessage({
          error,
          abortSignal,
          fallback: resolveErrorMessage(error),
        })
      : resolveErrorMessage(error);
  const requestId = resolveRequestId(error);

  return {
    classification: normalizedClassification,
    message,
    ...metadata,
    error: {
      classification: normalizedClassification,
      retryable: normalizedClassification === "retryable",
      fatal: normalizedClassification === "fatal",
      abort: normalizedClassification === "abort",
      name: name || undefined,
      message,
      status,
      code,
      type,
      requestId,
      source: String(metadata?.source || "").trim() || undefined,
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
  const classification = classifyEngineError(error);
  const payload = buildEngineErrorPayload({
    error,
    abortSignal,
    classification,
    metadata,
  });
  emitEvent(eventListener, event, payload);
  return {
    classification,
    error,
    payload,
  };
}
