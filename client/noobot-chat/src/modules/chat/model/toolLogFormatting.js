/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";
export { projectToolFileDisplay } from "@noobot/event-protocol/tool-presentation";

const FAILED_TOOL_STATUSES = new Set(["failed", "failure", "error", "errored"]);

function parseToolResultValue(value) {
  if (!value || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function isToolResultFailure({ success, status, result, detailText } = {}) {
  if (success === false) return true;
  if (FAILED_TOOL_STATUSES.has(text(status).toLowerCase())) return true;
  for (const value of [result, detailText]) {
    const parsed = parseToolResultValue(value);
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.ok === false || parsed.success === false) return true;
    if (FAILED_TOOL_STATUSES.has(text(parsed.status).toLowerCase())) return true;
  }
  return false;
}
