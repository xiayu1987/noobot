/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isFunction, isPlainObject, text } from "@noobot/shared/value";

export const MAIN_FLOW_CONTROL_ACTION = Object.freeze({
  SUMMARY_CHECKPOINT: "summary_checkpoint",
  PHASE_SUMMARY: "phase_summary",
});

export const MAIN_FLOW_CONTROL_PORT_METHODS = Object.freeze([
  "claimSummaryScheduling",
  "requestPhaseSummary",
  "hasPendingSummary",
  "requestSummaryCheckpoint",
  "isFinalNoToolsTurnEngaged",
]);

function requireSource(source, label) {
  const value = text(source);
  if (!value) throw new TypeError(`${label} requires source`);
  return value;
}

export function createSummarySchedulingClaim({ source } = {}) {
  return Object.freeze({ source: requireSource(source, "summary scheduling claim") });
}

export function createPhaseSummaryInstruction({ source, prompt, onCommitted } = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("phase summary prompt must be a non-empty string");
  }
  if (!isFunction(onCommitted)) {
    throw new TypeError("phase summary onCommitted must be a function");
  }
  return Object.freeze({
    action: MAIN_FLOW_CONTROL_ACTION.PHASE_SUMMARY,
    source: requireSource(source, "phase summary instruction"),
    prompt,
    onCommitted,
  });
}

export function createSummaryCheckpointInstruction({ source, summarizedMessageUids, onCommitted }) {
  if (onCommitted !== undefined && !isFunction(onCommitted)) {
    throw new TypeError("summary checkpoint onCommitted must be a function");
  }
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
    ...(onCommitted ? { onCommitted } : {}),
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
