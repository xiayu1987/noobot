/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isPlainObject, text } from "@noobot/shared/value";

export const MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  FINAL_NO_TOOLS_TURN: "final_no_tools_turn",
  SUMMARY_CHECKPOINT: "summary_checkpoint",
});

export const MAIN_FLOW_CONTROL_REASON = Object.freeze({
  CONTEXT_OVERFLOW_AFTER_SUMMARY: "context_overflow_after_summary",
  TASK_SUMMARY_COMPLETE: "task_summary_complete",
  TASK_SUMMARY_BLOCKED: "task_summary_blocked",
});

const MAIN_FLOW_CONTROL_REASONS = new Set(Object.values(MAIN_FLOW_CONTROL_REASON));

export const MAIN_FLOW_CONTROL_PORT_METHODS = Object.freeze([
  "requestSummaryCheckpoint",
  "isFinalNoToolsTurnEngaged",
]);

function requireSource(source, label) {
  const value = text(source);
  if (!value) throw new TypeError(`${label} requires source`);
  return value;
}

export function createSummaryCheckpointInstruction({ source, summarizedMessageUids } = {}) {
  const canonicalSource = requireSource(source, "summary checkpoint instruction");
  if (!Array.isArray(summarizedMessageUids) || summarizedMessageUids.length === 0) {
    throw new TypeError("summary checkpoint instruction requires non-empty summarizedMessageUids");
  }
  const uids = summarizedMessageUids.map((uid) => text(uid));
  if (uids.some((uid) => !uid)) {
    throw new TypeError(
      "summary checkpoint instruction summarizedMessageUids must be non-empty strings",
    );
  }
  if (new Set(uids).size !== uids.length) {
    throw new TypeError("summary checkpoint instruction summarizedMessageUids must be unique");
  }
  return Object.freeze({
    action: MAIN_FLOW_CONTROL_ACTION.SUMMARY_CHECKPOINT,
    source: canonicalSource,
    summarizedMessageUids: Object.freeze(uids),
  });
}

export function createFinalNoToolsTurnInstruction({ reason, source, detail = {} } = {}) {
  if (!MAIN_FLOW_CONTROL_REASONS.has(reason)) {
    throw new TypeError(`final no-tools turn instruction has unknown reason: ${text(reason)}`);
  }
  if (!isPlainObject(detail)) {
    throw new TypeError("final no-tools turn instruction detail must be a plain object");
  }
  return Object.freeze({
    action: MAIN_FLOW_CONTROL_ACTION.FINAL_NO_TOOLS_TURN,
    reason,
    source: requireSource(source, "final no-tools turn instruction"),
    requestedAt: new Date().toISOString(),
    detail,
  });
}

export function assertMainFlowControlPort(port) {
  if (!isPlainObject(port)) {
    throw new TypeError("main flow control port must be a plain object");
  }
  const missing = MAIN_FLOW_CONTROL_PORT_METHODS.filter((name) => !isFunction(port[name]));
  if (missing.length) {
    throw new TypeError(`main flow control port is missing: ${missing.join(",")}`);
  }
  return port;
}
