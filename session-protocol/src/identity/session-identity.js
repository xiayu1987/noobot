/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
const clean = (value) => String(value || "").trim();

export function createSessionIdentity({ userId = "", sessionId = "", parentSessionId = "" } = {}) {
  return Object.freeze({ userId: clean(userId), sessionId: clean(sessionId), parentSessionId: clean(parentSessionId) });
}

export function validateSessionIdentity(identity = {}) {
  const errors = [];
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return { valid: false, errors: ["invalid_session_identity"] };
  if (!clean(identity.userId)) errors.push("missing_user_id");
  if (!clean(identity.sessionId)) errors.push("missing_session_id");
  if (Object.keys(identity).some((key) => !["userId", "sessionId", "parentSessionId"].includes(key))) errors.push("unknown_session_identity_field");
  return { valid: errors.length === 0, errors };
}

export function isSameSessionIdentity(left = {}, right = {}) {
  const leftId = typeof left === "string" ? clean(left) : clean(left.sessionId);
  const rightId = typeof right === "string" ? clean(right) : clean(right.sessionId);
  return Boolean(leftId) && leftId === rightId;
}
