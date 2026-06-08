/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { logError } from "../../../tracking/console/logger.js";
import { resolveMessageDialogProcessId } from "../../../context/session/dialog-process-id-resolver.js";
import { toToolJsonResult } from "../../core/tool-json-result.js";
import { SESSION_ASYNC_STATUS } from "../../../bot-manage/config/constants.js";
import { TOOL_NAME } from "../../constants/index.js";

export function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(value);
    } catch (error) {
      logError("[agent-collab-tool] structuredClone fallback failed", {
        error: error?.message || String(error),
      });
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    logError("[agent-collab-tool] JSON.stringify/parse clone fallback failed", {
      error: error?.message || String(error),
    });
    return value;
  }
}

export function normalizeString(value = "") {
  return String(value || "").trim();
}

export function toTaskRequest(taskItem = {}, sessionId = "") {
  return {
    sessionId: normalizeString(sessionId),
    taskName: normalizeString(taskItem?.taskName),
    taskContent: normalizeString(taskItem?.taskContent),
  };
}

export function summarizeTaskResultsStatus(taskResults = []) {
  const failed = taskResults.some(
    (item) =>
      String(item?.status || "") === SESSION_ASYNC_STATUS.FAILED ||
      item?.ok === false,
  );
  if (failed) return SESSION_ASYNC_STATUS.FAILED;
  const stopped = taskResults.some(
    (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.STOPPED,
  );
  if (stopped) return SESSION_ASYNC_STATUS.STOPPED;
  const completed = taskResults.every(
    (item) => String(item?.status || "") === SESSION_ASYNC_STATUS.COMPLETED,
  );
  return completed
    ? SESSION_ASYNC_STATUS.COMPLETED
    : SESSION_ASYNC_STATUS.RUNNING;
}

export function buildWaitTaskRequest({
  sessionId = "",
  taskName = "",
  taskContent = "",
} = {}) {
  return {
    sessionId: normalizeString(sessionId),
    taskName: normalizeString(taskName),
    taskContent: normalizeString(taskContent),
  };
}

export function buildDelegateTaskFailureResult({
  index = 0,
  error = "",
  request = {},
  parentAsyncResultContainer = null,
} = {}) {
  return {
    ok: false,
    index,
    error: normalizeString(error),
    parentAsyncResultContainer: parentAsyncResultContainer || null,
    request: {
      ...request,
    },
  };
}

export function buildWaitTaskInvalidResult({
  index = 0,
  request = {},
  error = "",
} = {}) {
  return {
    ok: false,
    index,
    status: SESSION_ASYNC_STATUS.INVALID_REQUEST,
    error: normalizeString(error),
    request,
  };
}

export function buildWaitTaskFailedResult({
  index = 0,
  request = {},
  error = "",
} = {}) {
  return {
    ok: false,
    index,
    status: SESSION_ASYNC_STATUS.FAILED,
    error: normalizeString(error),
    request,
  };
}

export function buildWaitAsyncTaskResultPayload({
  ok = true,
  status = SESSION_ASYNC_STATUS.RUNNING,
  nextPollInMs = 0,
  containers = [],
  containerStatuses = [],
  taskStats = {},
  attachmentMetas = [],
  transferResult = null,
  transferEnvelope = null,
  transferEnvelopes = [],
} = {}) {
  void attachmentMetas;
  const normalizedTransferEnvelopes = Array.isArray(transferEnvelopes) ? transferEnvelopes : [];
  const normalizedTransferEnvelope =
    transferEnvelope && typeof transferEnvelope === "object" && !Array.isArray(transferEnvelope)
      ? transferEnvelope
      : normalizedTransferEnvelopes[0] || null;
  const normalizedTransferResult =
    transferResult && typeof transferResult === "object" && !Array.isArray(transferResult)
      ? transferResult
      : null;

  return toToolJsonResult(
    TOOL_NAME.WAIT_ASYNC_TASK_RESULT,
    {
      ok,
      status,
      checked_at: new Date().toISOString(),
      next_poll_in_ms: nextPollInMs,
      child_async_result_containers: cloneData(containers),
      container_statuses: containerStatuses,
      task_stats: taskStats,
      ...(normalizedTransferResult ? { transferResult: normalizedTransferResult } : {}),
      ...(normalizedTransferEnvelope ? { transferEnvelope: normalizedTransferEnvelope } : {}),
      ...(normalizedTransferEnvelopes.length ? { transferEnvelopes: normalizedTransferEnvelopes } : {}),
    },
    true,
  );
}

export function summarizeAsyncTaskResult(result = null) {
  if (!result || typeof result !== "object") return null;
  const answer = String(result?.answer || "").trim();
  return {
    sessionId: String(result?.sessionId || "").trim(),
    parentSessionId: String(result?.parentSessionId || "").trim(),
    parentDialogProcessId: String(result?.parentDialogProcessId || "").trim(),
    dialogProcessId: resolveMessageDialogProcessId(result),
    answer,
    hasAnswer: Boolean(answer),
    messageCount: Array.isArray(result?.messages) ? result.messages.length : 0,
    traceCount: Array.isArray(result?.traces) ? result.traces.length : 0,
    turnTaskCount: Array.isArray(result?.turnTasks) ? result.turnTasks.length : 0,
  };
}
