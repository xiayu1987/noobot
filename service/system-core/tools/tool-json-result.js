/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value = "") {
  return String(value || "").trim();
}

const COMMON_RESULT_FIELDS = [
  "ok",
  "status",
  "error",
  "message",
  "summary",
  "sessionId",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "tools",
];

function normalizeCommonFieldValue(key, value) {
  if (value === undefined || value === null) return undefined;
  if (key === "ok") return Boolean(value);
  if (
    key === "status" &&
    (typeof value === "string" || typeof value === "number")
  ) {
    return value;
  }
  if (
    key === "error" ||
    key === "message" ||
    key === "sessionId" ||
    key === "parentSessionId" ||
    key === "parentDialogProcessId" ||
    key === "dialogProcessId"
  ) {
    const normalized = normalizeString(value);
    return normalized || undefined;
  }
  if (key === "tools") {
    if (!Array.isArray(value)) return undefined;
    const list = Array.from(
      new Set(value.map((item) => normalizeString(item)).filter(Boolean)),
    );
    return list.length ? list : undefined;
  }
  if (key === "summary") {
    return isPlainObject(value) ? value : undefined;
  }
  return value;
}

export function buildToolResultPayload(payload = {}) {
  const src = isPlainObject(payload) ? payload : { data: payload };
  const out = {};
  for (const field of COMMON_RESULT_FIELDS) {
    const normalized = normalizeCommonFieldValue(field, src[field]);
    if (normalized !== undefined) out[field] = normalized;
  }
  for (const [key, value] of Object.entries(src)) {
    if (COMMON_RESULT_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

export function toToolJsonResult(toolName, payload = {}, pretty = false) {
  const normalizedPayload = buildToolResultPayload(payload);
  return JSON.stringify(
    {
      toolName: String(toolName || "").trim(),
      ...normalizedPayload,
    },
    null,
    pretty ? 2 : 0,
  );
}
