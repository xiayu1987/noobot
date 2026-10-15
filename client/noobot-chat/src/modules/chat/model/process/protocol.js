/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

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

export function normalizeProcessString(value = "") {
  return text(value);
}

export function toProcessSequence(value, fallback = 0) {
  const sequence = Number(value);
  if (Number.isFinite(sequence) && sequence >= 0) return sequence;
  const fallbackSequence = Number(fallback);
  return Number.isFinite(fallbackSequence) && fallbackSequence >= 0 ? fallbackSequence : 0;
}
