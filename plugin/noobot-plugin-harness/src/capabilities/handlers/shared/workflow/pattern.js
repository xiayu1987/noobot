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
    category = "",
    chosenAction = "none",
    chosenReason = "idle",
    chosenStage = "",
    candidateActions = [],
    deferredActions = [],
    triggeredActions = [],
    blockedActions = [],
    blockedReasons = [],
    pending = {},
  } = {},
) {
  const normalizedCandidateActions = Array.isArray(candidateActions) ? candidateActions : [];
  const normalizedTriggeredActions = Array.isArray(triggeredActions) ? triggeredActions : [];
  return appendCapabilityLog(ctx, {
    domain,
    event: WORKFLOW_EVENTS.priorityDecision,
    detail: {
      point: String(point || "").trim() || undefined,
      mode: String(mode || "").trim() || undefined,
      category: String(category || "").trim() || undefined,
      chosenAction,
      chosenReason,
      chosenStage: String(chosenStage || "").trim() || undefined,
      candidateActions: normalizedCandidateActions,
      deferredActions: Array.isArray(deferredActions) ? deferredActions : [],
      // Keep legacy field for downstream consumers during migration.
      triggeredActions: normalizedTriggeredActions.length ? normalizedTriggeredActions : normalizedCandidateActions,
      blockedActions: Array.isArray(blockedActions) ? blockedActions : [],
      blockedReasons: Array.isArray(blockedReasons) ? blockedReasons : [],
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
    category = "",
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
      category: String(category || "").trim() || undefined,
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

function resolveThrownErrorCode(error = null) {
  if (!error || typeof error !== "object") return "";
  const code = String(error?.code || error?.name || "").trim();
  if (!code) return "";
  return code
    .replaceAll(/[^a-zA-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toUpperCase();
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

export async function runWorkflowLifecycle(
  ctx = {},
  {
    domain = "",
    point = "",
    mode = "",
    resolveDecision = () =>
      ({
        category: "",
        chosenAction: "none",
        chosenReason: "idle",
        candidateActions: [],
        deferredActions: [],
        triggeredActions: [],
        blockedActions: [],
        blockedReasons: [],
        pending: {},
      }),
    execute = async () => ({ requestedAction: "none", executedPrimary: false, executedFollowup: false, changed: false }),
  } = {},
) {
  const startedAt = Date.now();
  const logCursor = captureWorkflowLogCursor(ctx, domain);
  const decision = resolveDecision() || {};
  appendWorkflowPriorityDecision(ctx, {
    domain,
    point,
    mode,
    category: decision.category || "",
    chosenAction: decision.chosenAction || "none",
    chosenReason: decision.chosenReason || "idle",
    chosenStage: decision.chosenStage || "",
    candidateActions: decision.candidateActions || [],
    deferredActions: decision.deferredActions || [],
    triggeredActions: decision.triggeredActions || [],
    blockedActions: decision.blockedActions || [],
    blockedReasons: decision.blockedReasons || [],
    pending: decision.pending || {},
  });
  let execution = { requestedAction: "none", executedPrimary: false, executedFollowup: false, changed: false };
  let caughtError = null;
  try {
    execution = (await execute(decision)) || execution;
  } catch (error) {
    caughtError = error;
  } finally {
    const metrics = resolveWorkflowExecutionMetrics(ctx, {
      domain,
      startCursor: logCursor,
    });
    appendWorkflowExecutionResult(ctx, {
      domain,
      point,
      mode,
      category: decision.category || "",
      chosenAction: decision.chosenAction || "none",
      chosenReason: decision.chosenReason || "idle",
      requestedAction: execution.requestedAction || "none",
      executedPrimary: execution.executedPrimary === true,
      executedFollowup: execution.executedFollowup === true,
      changed: execution.changed === true,
      durationMs: Date.now() - startedAt,
      retryCount: metrics.retryCount,
      errorCode: metrics.errorCode || resolveThrownErrorCode(caughtError),
    });
    if (caughtError) throw caughtError;
    return {
      decision,
      execution: {
        requestedAction: execution.requestedAction || "none",
        executedPrimary: execution.executedPrimary === true,
        executedFollowup: execution.executedFollowup === true,
        changed: execution.changed === true,
      },
      metrics,
    };
  }
}
