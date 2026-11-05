/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
import { isCanonicalMessageTimestamp } from "@noobot/session-protocol";

export const TOOL_CALL_START_EVENT = "tool_call_start";
export const TOOL_CALL_END_EVENT = "tool_call_end";

export function resolveData(log) {
  return log.data && typeof log.data === "object" ? log.data : {};
}

export function resolveToolName(log) {
  return text(resolveData(log).tool);
}

export function resolveTimestampMs(log) {
  if (!isCanonicalMessageTimestamp(log.ts)) {
    throw new TypeError("execution log requires canonical ISO ts");
  }
  return Date.parse(log.ts);
}

export function isFailedToolResult(log) {
  return log.event === TOOL_CALL_END_EVENT && resolveData(log).success !== true;
}
