/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function nowIsoTimestamp() {
  return new Date().toISOString();
}

export function buildStatusSummary(
  items = [],
  {
    statusAccessor = (item = {}) => item?.status,
    fields = [],
  } = {},
) {
  const source = Array.isArray(items) ? items : [];
  const summary = { total: source.length };
  for (const field of Array.isArray(fields) ? fields : []) {
    const key = String(field?.key || "").trim();
    const value = String(field?.value || "").trim();
    if (!key || !value) continue;
    summary[key] = source.filter((item) => String(statusAccessor(item) || "") === value).length;
  }
  return summary;
}
