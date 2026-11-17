/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireDialogProcessKey } from "../identity.js";

export * from "./execution-log-projection-output.js";

export const EXECUTION_LOG_PROJECTION_CURSOR_FILE = "projection-cursor.json";
export const EXECUTION_LOG_PROJECTION_CURSOR_VERSION = 1;

export function requireExecutionLogProjectionCursor(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 3 ||
    value.version !== EXECUTION_LOG_PROJECTION_CURSOR_VERSION ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0
  )
    throw new TypeError("Invalid execution log projection cursor");
  return value;
}

export function executionLogProjectionIdentity(dialogProcessId, sequence, offset) {
  requireDialogProcessKey(dialogProcessId);
  requireExecutionLogProjectionCursor({ version: 1, sequence, offset });
  return JSON.stringify([dialogProcessId, sequence, offset]);
}

export function requireExecutionLogProjectionOutcomes(records, outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length !== records.length)
    throw new TypeError("Execution projection requires an explicit outcome for every record");
  for (const outcome of outcomes)
    if (!["written", "skipped", "failed", "unknown"].includes(outcome))
      throw new TypeError("Execution projection requires an explicit outcome for every record");
  return outcomes;
}

export function requireExecutionLogProjectionDelivery(records, outcomes) {
  requireExecutionLogProjectionOutcomes(records, outcomes);
  if (outcomes.some((outcome) => outcome !== "written" && outcome !== "skipped"))
    throw new TypeError(
      "Execution projection delivery requires written or skipped for every record",
    );
  return outcomes;
}
