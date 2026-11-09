/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { isCanonicalText } from "@noobot/shared/value";

const TURN_KEY_PREFIX = "__turn__";

function createTurnIdentity({ sessionId = "", turnScopeId = "", dialogProcessId = "" } = {}) {
  const identity = Object.freeze({
    sessionId,
    turnScopeId,
    dialogProcessId,
  });
  if (
    (sessionId !== "" && !isCanonicalText(sessionId)) ||
    (turnScopeId !== "" && !isCanonicalTurnScopeId(turnScopeId)) ||
    (dialogProcessId !== "" && !isCanonicalText(dialogProcessId))
  ) {
    throw new TypeError("invalid_turn_identity");
  }
  return identity;
}

export function resolveEnvelopeTurnIdentity(value) {
  return createTurnIdentity({
    sessionId: value?.identity?.sessionId,
    turnScopeId: value?.identity?.turnScopeId,
    dialogProcessId: value?.payload?.dialogProcessId,
  });
}

export function resolveTurnIdentity(value = {}) {
  return createTurnIdentity({
    sessionId: value.sessionId,
    turnScopeId: value.turnScopeId,
    dialogProcessId: value.dialogProcessId,
  });
}

export function createTurnKey(identity = {}) {
  const { sessionId, turnScopeId } = createTurnIdentity(identity);
  if (!sessionId || !turnScopeId) return "";
  return `${TURN_KEY_PREFIX}${encodeURIComponent(sessionId)}::${encodeURIComponent(turnScopeId)}`;
}

export function parseTurnKey(key = "") {
  if (!isCanonicalText(key) || !key.startsWith(TURN_KEY_PREFIX)) return null;
  const parts = key.slice(TURN_KEY_PREFIX.length).split("::");
  if (parts.length !== 2) return null;
  const [encodedSessionId, encodedTurnScopeId] = parts;
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

export function messageOwnsTurn(message, identity) {
  return message.turnScopeId === identity.turnScopeId;
}
