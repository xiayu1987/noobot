/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { appendCapabilityLog } from "../attachment-log-utils.js";
import { ensureHarnessBucket } from "../bucket-utils.js";
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";

const WORKFLOW_EVENTS = WORKFLOW_PARAMS.workflow.events;

export function resolveWorkflowMode(meta = {}) {
  return meta?.harness?.planningGuidanceMode === "separate_model" ? "separate_model" : "inject";
}

export function appendWorkflowPriorityDecision(
  ctx = {},
  {
    domain = "",
    point = "",
    mode = "",
    chosenAction = "none",
    chosenReason = "idle",
    chosenStage = "",
    blockedActions = [],
    pending = {},
  } = {},
) {
  return appendCapabilityLog(ctx, {
    domain,
    event: WORKFLOW_EVENTS.priorityDecision,
    detail: {
      point: String(point || "").trim() || undefined,
      mode: String(mode || "").trim() || undefined,
      chosenAction,
      chosenReason,
      chosenStage: String(chosenStage || "").trim() || undefined,
      blockedActions: Array.isArray(blockedActions) ? blockedActions : [],
      pending: pending && typeof pending === "object" ? pending : {},
    },
  });
}

export function appendWorkflowExecutionResult(
  ctx = {},
  {
    domain = "",
    point = "",
    mode = "",
    chosenAction = "none",
    chosenReason = "idle",
    requestedAction = "none",
    executedPrimary = false,
    executedFollowup = false,
    changed = false,
    durationMs = null,
    retryCount = null,
    errorCode = "",
  } = {},
) {
  const normalizedDuration = Number.isFinite(Number(durationMs)) ? Number(durationMs) : undefined;
  const normalizedRetryCount = Number.isFinite(Number(retryCount)) ? Number(retryCount) : undefined;
  const normalizedErrorCode = String(errorCode || "").trim() || undefined;
  return appendCapabilityLog(ctx, {
    domain,
    event: WORKFLOW_EVENTS.executionResult,
    detail: {
      point: String(point || "").trim() || undefined,
      mode: String(mode || "").trim() || undefined,
      chosenAction,
      chosenReason,
      requestedAction,
      executedPrimary: executedPrimary === true,
      executedFollowup: executedFollowup === true,
      changed: changed === true,
      durationMs: normalizedDuration,
      retryCount: normalizedRetryCount,
      errorCode: normalizedErrorCode,
    },
  });
}

export function captureWorkflowLogCursor(ctx = {}, domain = "") {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return 0;
  const logs = holder?.bucket?.logs?.[domain];
  return Array.isArray(logs) ? logs.length : 0;
}

function resolveEventErrorCode(eventName = "") {
  const normalized = String(eventName || "").trim();
  if (!normalized) return "";
  if (normalized.endsWith("_failed") || normalized.endsWith("_error")) {
    return normalized.toUpperCase();
  }
  return "";
}

export function resolveWorkflowExecutionMetrics(
  ctx = {},
  { domain = "", startCursor = 0 } = {},
) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return { retryCount: 0, errorCode: "" };
  const logs = holder?.bucket?.logs?.[domain];
  if (!Array.isArray(logs)) return { retryCount: 0, errorCode: "" };
  const begin = Number.isFinite(Number(startCursor)) ? Math.max(0, Number(startCursor)) : 0;
  const slice = logs.slice(begin);
  let retryCount = 0;
  let errorCode = "";
  for (const item of slice) {
    const eventName = String(item?.event || "").trim();
    if (!eventName) continue;
    if (eventName === WORKFLOW_EVENTS.reasoningRetryScheduled) {
      retryCount += 1;
      continue;
    }
    if (!errorCode) {
      const candidate = resolveEventErrorCode(eventName);
      if (candidate) {
        errorCode = candidate;
      }
    }
  }
  return { retryCount, errorCode };
}
