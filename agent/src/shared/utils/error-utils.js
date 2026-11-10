/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  assertExecutionNotAborted,
  isExecutionAbortError,
  raceExecutionAbort,
} from "@noobot/session-protocol/execution-abort";
import { resolveErrorHeaderValue } from "./error-header.js";

function resolveErrorStatus(error) {
  const rawStatus =
    error?.status ??
    error?.statusCode ??
    error?.error?.status ??
    error?.response?.status ??
    error?.cause?.status ??
    error?.cause?.statusCode ??
    error?.cause?.error?.status;
  if (typeof rawStatus !== "number" && typeof rawStatus !== "string") return undefined;
  const status = Number(rawStatus);
  return Number.isInteger(status) && status > 0 ? status : undefined;
}

function resolveErrorField(error, field) {
  const sources = [error, error?.error, error?.cause, error?.cause?.error];
  for (const source of sources) {
    const value = source?.[field];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function resolveErrorRequestId(error) {
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

export function resolveErrorDetails(error) {
  return {
    status: resolveErrorStatus(error),
    code: resolveErrorField(error, "code"),
    type: resolveErrorField(error, "type"),
    requestId: resolveErrorRequestId(error),
  };
}

export const isAbortError = (error, abortSignal = null) =>
  isExecutionAbortError({ error, abortSignal });

function normalizeErrorText(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

export function resolveErrorMessage(error = null) {
  const structuredCandidates = [
    error?.message,
    error?.error?.message,
    error?.error,
    error?.response?.data?.error?.message,
    error?.response?.data?.error,
    error?.response?.data?.message,
    error?.cause?.message,
    error?.cause?.error?.message,
    error?.cause?.error,
    error?.cause,
  ];
  for (const candidate of structuredCandidates) {
    const message = normalizeErrorText(candidate);
    if (message) return message;
  }

  const identityCandidates = [
    error?.type,
    error?.stopType,
    error?.code,
    error?.name,
    error?.error?.type,
    error?.error?.code,
    error?.cause?.type,
    error?.cause?.stopType,
    error?.cause?.code,
    error?.cause?.name,
  ];
  for (const candidate of identityCandidates) {
    const message = normalizeErrorText(candidate);
    if (message) return message;
  }

  return normalizeErrorText(error);
}

export function assertNotAborted(abortSignal) {
  assertExecutionNotAborted({ abortSignal });
}

export function raceWithAbort(promise, abortSignal) {
  return raceExecutionAbort(promise, { abortSignal });
}
