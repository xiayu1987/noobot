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
    error?.error?.status ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode ??
    error?.cause?.error?.status;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : undefined;
}

function resolveHeaderValue(headers = null, name = "") {
  if (!headers || !name) return undefined;
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return undefined;
  if (typeof headers?.get === "function") {
    return (
      headers.get(normalizedName) ||
      headers.get(normalizedName.toLowerCase()) ||
      undefined
    );
  }
  return (
    headers?.[normalizedName] ??
    headers?.[normalizedName.toLowerCase()] ??
    undefined
  );
}

function resolveRequestId(error = {}) {
  return (
    error?.request_id ??
    error?.requestId ??
    error?.requestID ??
    resolveHeaderValue(error?.headers, "x-request-id") ??
    resolveHeaderValue(error?.response?.headers, "x-request-id") ??
    resolveHeaderValue(error?.cause?.headers, "x-request-id") ??
    resolveHeaderValue(error?.cause?.response?.headers, "x-request-id") ??
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
  const code =
    error?.code ??
    error?.error?.code ??
    error?.cause?.code ??
    error?.cause?.error?.code ??
    undefined;
  const type =
    error?.type ??
    error?.error?.type ??
    error?.cause?.type ??
    error?.cause?.error?.type ??
    undefined;
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
