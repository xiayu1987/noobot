/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const text = (value) => String(value || "").trim();
const TURN_KEY_PREFIX = "__turn__";

export function createTurnIdentity({ sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const identity = Object.freeze({
    sessionId: text(sessionId),
    turnScopeId: text(turnScopeId),
    dialogProcessId: text(dialogProcessId),
  });
  return identity;
}

export function resolveTurnIdentity(value = {}, fallback = {}) {
  const event = value?.messageEvent || value?.event || {};
  return createTurnIdentity({
    sessionId: value?.sessionId || event?.sessionId || fallback?.sessionId,
    turnScopeId: value?.turnScopeId || value?.statusTurnScopeId || event?.turnScopeId || fallback?.turnScopeId,
    dialogProcessId: value?.dialogProcessId || event?.dialogProcessId || fallback?.dialogProcessId,
  });
}

export function createTurnKey(identity = {}) {
  const { sessionId, turnScopeId } = createTurnIdentity(identity);
  if (!sessionId || !turnScopeId) return "";
  return `${TURN_KEY_PREFIX}${encodeURIComponent(sessionId)}::${encodeURIComponent(turnScopeId)}`;
}

export function parseTurnKey(key = "") {
  const normalized = text(key);
  if (!normalized.startsWith(TURN_KEY_PREFIX)) return null;
  const [encodedSessionId = "", encodedTurnScopeId = ""] = normalized
    .slice(TURN_KEY_PREFIX.length)
    .split("::");
  if (!encodedSessionId || !encodedTurnScopeId) return null;
  try {
    return createTurnIdentity({
      sessionId: decodeURIComponent(encodedSessionId),
      turnScopeId: decodeURIComponent(encodedTurnScopeId),
    });
  } catch {
    return null;
  }
}

export function messageOwnsTurn(message = {}, identity = {}) {
  const expected = createTurnIdentity(identity);
  const messageSessionId = text(message?.sessionId);
  const messageTurnScopeId = text(message?.turnScopeId);
  if (!expected.turnScopeId || messageTurnScopeId !== expected.turnScopeId) return false;
  return !expected.sessionId || !messageSessionId || messageSessionId === expected.sessionId;
}
