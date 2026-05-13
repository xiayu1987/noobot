/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { emitEvent } from "../../../event/index.js";
import { classifyEngineError } from "./error-classifier.js";

function resolveErrorStatus(error = {}) {
  const rawStatus =
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : undefined;
}

function resolveRequestId(error = {}) {
  return (
    error?.request_id ??
    error?.requestId ??
    error?.headers?.["x-request-id"] ??
    error?.response?.headers?.["x-request-id"] ??
    undefined
  );
}

export function buildEngineErrorPayload({
  error,
  classification,
  metadata = {},
} = {}) {
  const normalizedClassification =
    classification || classifyEngineError(error);
  const status = resolveErrorStatus(error);
  const code = error?.code ?? error?.cause?.code ?? undefined;
  const type = error?.type ?? error?.cause?.type ?? undefined;
  const name = String(error?.name || error?.cause?.name || "").trim();
  const message = String(error?.message || error || "").trim();
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
  eventListener = null,
  event = "agent_error",
  metadata = {},
} = {}) {
  const classification = classifyEngineError(error);
  const payload = buildEngineErrorPayload({
    error,
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
