/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text as clean } from "@noobot/shared/value";
import { createSessionIdentity, validateSessionIdentity } from "./identity/session-identity.js";
import { normalizeTurnIdentity } from "./identity/turn-identity.js";

const SESSION_ID_MAX_LENGTH = 200;
const DIALOG_PROCESS_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function normalizeSessionId(value = "") {
  return clean(value).slice(0, SESSION_ID_MAX_LENGTH);
}

export function normalizeParentSessionId(value = "") {
  return normalizeSessionId(value);
}

export function isCanonicalSessionId(value) {
  return typeof value === "string" && Boolean(value) && value === normalizeSessionId(value);
}

export function isCanonicalParentSessionId(value) {
  return typeof value === "string" && value === normalizeParentSessionId(value);
}

export function normalizeDialogProcessId(value = "") {
  return clean(value);
}

export function isDialogProcessKey(value) {
  return DIALOG_PROCESS_KEY_PATTERN.test(clean(value));
}

export function requireDialogProcessKey(value) {
  const key = clean(value);
  if (DIALOG_PROCESS_KEY_PATTERN.test(key)) return key;
  const error = new TypeError(`invalid dialogProcessId: "${key}"`);
  error.code = "DIALOG_PROCESS_ID_INVALID";
  throw error;
}

export function createSessionScope({ userId = "", sessionId = "", parentSessionId = "" } = {}) {
  return createSessionIdentity({
    userId,
    sessionId: normalizeSessionId(sessionId),
    parentSessionId: normalizeParentSessionId(parentSessionId),
  });
}

export function validateSessionScope(scope = {}) {
  return validateSessionIdentity(scope);
}

export function createTurnIdentity({ dialogProcessId = "", turnScopeId = "" } = {}) {
  return normalizeTurnIdentity({ dialogProcessId, turnScopeId });
}

export function sessionIdentity(session = {}) {
  return clean(session.sessionId);
}
