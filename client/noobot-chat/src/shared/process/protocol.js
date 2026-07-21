/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { nowIso } from "../../composables/infra/timeFields";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";

export const PROCESS_EVENT_VERSION = 1;

export const ProcessStatus = Object.freeze({
  CREATED: "created",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
  UNKNOWN: "unknown",
});

export const ProcessNodeStatus = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
  WARNING: "warning",
});

export const ProcessEventType = Object.freeze({
  PROCESS_STARTED: "process_started",
  PROCESS_UPDATED: "process_updated",
  PROCESS_FINISHED: "process_finished",
  NODE_UPSERTED: "node_upserted",
  NODE_FINISHED: "node_finished",
});

export const ProcessEventSource = Object.freeze({
  STREAM: "stream",
  SNAPSHOT: "snapshot",
  SESSION_DETAIL: "session_detail",
  COMPLETED_TOOL_LOGS: "completed_tool_logs",
  UNKNOWN: "unknown",
});

export const PROCESS_COMPAT_LOG_LIMIT = QUANTITY_THRESHOLDS.client.processCompatLogLimit;

export function normalizeProcessString(value = "") {
  return String(value ?? "").trim();
}

export function toProcessSequence(value, fallback = 0) {
  const sequence = Number(value);
  if (Number.isFinite(sequence) && sequence >= 0) return sequence;
  const fallbackSequence = Number(fallback);
  return Number.isFinite(fallbackSequence) && fallbackSequence >= 0 ? fallbackSequence : 0;
}

export function resolveProcessId(input = {}) {
  return normalizeProcessString(
    input.processId || input.dialogProcessId || input.parentDialogProcessId || input.sessionId,
  );
}

export function resolveProcessTimestamp(input = {}) {
  return normalizeProcessString(input.timestamp || input.ts || input.createdAt || input.updatedAt) || nowIso();
}

export function resolveExplicitProcessTimestamp(input = {}) {
  return normalizeProcessString(input.timestamp || input.ts || input.createdAt || input.updatedAt);
}

export function buildProcessEventId({
  source = ProcessEventSource.UNKNOWN,
  type = "event",
  processId = "",
  nodeId = "",
  sequence = 0,
  timestamp = "",
  event = "",
  text = "",
} = {}) {
  return [
    source,
    type,
    processId,
    nodeId,
    sequence,
    timestamp,
    event,
    String(text || "").slice(0, 120),
  ].join("|");
}

/**
 * @typedef {Object} ProcessEventMeta
 * @property {string} eventId
 * @property {number} sequence
 * @property {number} version
 * @property {string} processId
 * @property {string} timestamp
 * @property {string=} source
 * @property {string=} sessionId
 * @property {string=} dialogProcessId
 * @property {string=} parentDialogProcessId
 * @property {string=} toolCallId
 */

/**
 * @typedef {Object} ProcessNode
 * @property {string} id
 * @property {string} processId
 * @property {string=} parentId
 * @property {string} status
 * @property {string=} title
 * @property {string=} summary
 * @property {Object=} log
 * @property {string=} startedAt
 * @property {string=} endedAt
 */

/**
 * @typedef {Object} ProcessEvent
 * @property {number} version
 * @property {string} eventId
 * @property {number} sequence
 * @property {string} processId
 * @property {string} timestamp
 * @property {string} type
 * @property {ProcessEventMeta} meta
 * @property {Object=} payload
 */

/**
 * @typedef {Object} ProcessSnapshot
 * @property {number} version
 * @property {string} processId
 * @property {string} status
 * @property {number} lastSequence
 * @property {string} updatedAt
 * @property {ProcessNode[]} nodes
 * @property {Object=} meta
 */
