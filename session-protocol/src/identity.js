/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionIdentity,
  isSameSessionIdentity,
  validateSessionIdentity,
} from "./identity/session-identity.js";
import { normalizeTurnIdentity } from "./identity/turn-identity.js";
import { text as clean } from "./normalize.js";

const SESSION_ID_MAX_LENGTH = 200;

export function normalizeSessionId(value = "") {
  return clean(value).slice(0, SESSION_ID_MAX_LENGTH);
}

export function normalizeParentSessionId(value = "") {
  return normalizeSessionId(value);
}

export function normalizeDialogProcessId(value = "") {
  return clean(value);
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

export function isSameSession(left = {}, right = {}) {
  return isSameSessionIdentity(left, right);
}
