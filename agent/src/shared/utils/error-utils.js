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

function readErrorStatus(error) {
  return error?.status ?? error?.statusCode ?? error?.error?.status;
}

function resolveErrorStatus(error) {
  const rawStatus =
    readErrorStatus(error) ?? error?.response?.status ?? readErrorStatus(error?.cause);
  if (typeof rawStatus !== "number" && typeof rawStatus !== "string") return undefined;
  const status = Number(rawStatus);
  return Number.isInteger(status) && status > 0 ? status : undefined;
}

function resolveErrorField(error, field) {
  const value = error?.[field] ?? error?.error?.[field];
  if (value !== undefined && value !== null) return value;
  const cause = error?.cause;
  return cause?.[field] ?? cause?.error?.[field] ?? undefined;
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

function resolveNestedErrorMessage(error) {
  const message = normalizeErrorText(error?.message);
  if (message) return message;
  return normalizeErrorText(error);
}

function resolveResponseErrorMessage(response) {
  const data = response?.data;
  const message = resolveNestedErrorMessage(data?.error);
  if (message) return message;
  return normalizeErrorText(data?.message);
}

const ERROR_IDENTITY_FIELDS = Object.freeze(["type", "stopType", "code", "name"]);
const NESTED_ERROR_IDENTITY_FIELDS = Object.freeze(["type", "code"]);

function resolveErrorTextFields(error, fields) {
  for (const field of fields) {
    const message = normalizeErrorText(error?.[field]);
    if (message) return message;
  }
  return "";
}

export function resolveErrorMessage(error = null) {
  let message = normalizeErrorText(error?.message);
  if (message) return message;
  message = resolveNestedErrorMessage(error?.error);
  if (message) return message;

  message = resolveResponseErrorMessage(error?.response);
  if (message) return message;

  const cause = error?.cause;
  message = normalizeErrorText(cause?.message);
  if (message) return message;
  message = resolveNestedErrorMessage(cause?.error);
  if (message) return message;
  message = normalizeErrorText(cause);
  if (message) return message;

  message = resolveErrorTextFields(error, ERROR_IDENTITY_FIELDS);
  if (message) return message;
  message = resolveErrorTextFields(error?.error, NESTED_ERROR_IDENTITY_FIELDS);
  if (message) return message;
  message = resolveErrorTextFields(cause, ERROR_IDENTITY_FIELDS);
  if (message) return message;

  return normalizeErrorText(error);
}

export function assertNotAborted(abortSignal) {
  assertExecutionNotAborted({ abortSignal });
}

export function raceWithAbort(promise, abortSignal) {
  return raceExecutionAbort(promise, { abortSignal });
}
