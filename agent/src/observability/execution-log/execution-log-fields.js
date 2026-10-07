/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function resolveData(log = {}) {
  return log?.data && typeof log.data === "object" ? log.data : {};
}

export function resolveEvent(log = {}) {
  const data = resolveData(log);
  return String(data.rawEvent || data.event || log?.event || "").trim();
}

export function resolveToolName(log = {}) {
  const data = resolveData(log);
  return String(data.tool || data.toolName || log.tool || log.toolName || "").trim();
}
