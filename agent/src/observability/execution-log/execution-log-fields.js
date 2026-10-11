/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const TOOL_CALL_START_EVENT = "tool_call_start";
export const TOOL_CALL_END_EVENT = "tool_call_end";

export function resolveData(log) {
  return log.data && typeof log.data === "object" ? log.data : {};
}

export function resolveToolName(log) {
  return String(resolveData(log).tool || "").trim();
}

export function resolveTimestampMs(log) {
  const ms = Date.parse(String(log.ts || ""));
  return Number.isFinite(ms) ? ms : null;
}

export function isFailedToolResult(log) {
  return log.event === TOOL_CALL_END_EVENT && resolveData(log).success !== true;
}
