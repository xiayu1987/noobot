/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText } from "@noobot/shared/value";
import { requireCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";

export function requireSessionTurnViewSelection({ turnScopeIds, messageUids = [] }) {
  if (!Array.isArray(turnScopeIds) || !Array.isArray(messageUids))
    throw new TypeError("Session turn view requires turn scope and message UID arrays");
  if (!messageUids.every(isCanonicalText))
    throw new TypeError("Session turn view requires canonical message UIDs");
  return {
    turnScopeIds: [...new Set(turnScopeIds.map(requireCanonicalTurnScopeId))],
    messageUids: [...new Set(messageUids)],
  };
}

export function selectSessionMessageTurnScopeIds(turnOrder) {
  if (!Array.isArray(turnOrder)) throw new TypeError("Session turn order must be an array");
  const scopes = new Set();
  for (const item of turnOrder) {
    const scope = requireCanonicalTurnScopeId(item.turnScopeId);
    if (!Number.isSafeInteger(item.messageCount) || item.messageCount < 0)
      throw new TypeError("Session turn message count must be a non-negative integer");
    if (item.messageCount > 0) scopes.add(scope);
  }
  return [...scopes];
}
