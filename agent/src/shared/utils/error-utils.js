/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  assertExecutionNotAborted,
  isExecutionAbortError,
  isExecutionUserStop,
  raceExecutionAbort,
  resolveExecutionAbortReason,
  resolveExecutionAbortType,
} from "@noobot/session-protocol/execution-abort";

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

export function readAbortReason(error = null, abortSignal = null) {
  return resolveExecutionAbortReason({ error, abortSignal });
}

export function isUserStopAbort(error = null, abortSignal = null) {
  return isExecutionUserStop({ error, abortSignal });
}

export function resolveAbortStopType(error = null, abortSignal = null) {
  return resolveExecutionAbortType({ error, abortSignal });
}

export function assertNotAborted(abortSignal = null) {
  assertExecutionNotAborted({ abortSignal });
}

/**
 * 让任意 promise 对中止信号具备响应性。中止事实与错误构造均由
 * session-protocol 的 execution-abort 唯一提供，此处只做转发；
 * 中止文案由协议从 reason 派生，调用方不注入。
 */
export function raceWithAbort(promise, abortSignal = null) {
  return raceExecutionAbort(promise, { abortSignal });
}
