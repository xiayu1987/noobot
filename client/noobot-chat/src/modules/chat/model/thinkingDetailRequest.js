/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  collectTurnLookupKeyErrors,
  requireTurnLookupKey,
} from "@noobot/session-protocol/turn-lookup-key";
import { isCanonicalText, isFunction } from "@noobot/shared/value";

function messageTurnLookupKey(messageItem) {
  return { turnScopeId: messageItem.turnScopeId, dialogProcessId: messageItem.dialogProcessId };
}

function createThinkingDetailIdentity(sessionId, lookupKey) {
  return Object.freeze({
    sessionId,
    turnScopeId: lookupKey.turnScopeId,
    dialogProcessId: lookupKey.dialogProcessId,
    key: JSON.stringify([sessionId, lookupKey.turnScopeId, lookupKey.dialogProcessId]),
  });
}

export function resolveThinkingDetailIdentity(messageItem, sessionId) {
  const candidate = messageTurnLookupKey(messageItem);
  if (!isCanonicalText(sessionId) || collectTurnLookupKeyErrors(candidate).length > 0) return null;
  return createThinkingDetailIdentity(sessionId, requireTurnLookupKey(candidate));
}

export async function loadThinkingDetail({ sessionId, messageItem, fetchThinkingDetail }) {
  if (!isFunction(fetchThinkingDetail)) throw new TypeError("fetchThinkingDetail is required");
  if (!isCanonicalText(sessionId)) throw new TypeError("thinking detail sessionId is required");
  const identity = createThinkingDetailIdentity(
    sessionId,
    requireTurnLookupKey(messageTurnLookupKey(messageItem)),
  );
  return fetchThinkingDetail({
    sessionId: identity.sessionId,
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
  });
}
