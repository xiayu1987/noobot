/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const INVALID_OPTIONAL_SESSION_IDS = new Set(["undefined", "null"]);

export function normalizeOptionalSessionId(value, { maxLength = 160 } = {}) {
  const sessionId = String(value ?? "").trim();
  if (!sessionId || INVALID_OPTIONAL_SESSION_IDS.has(sessionId.toLowerCase())) return "";
  return maxLength > 0 ? sessionId.slice(0, maxLength) : sessionId;
}

export function resolveOptionalSessionId(...values) {
  for (const value of values) {
    const sessionId = normalizeOptionalSessionId(value);
    if (sessionId) return sessionId;
  }
  return "";
}
