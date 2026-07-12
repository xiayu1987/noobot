/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function normalizeWsText(value = "") {
  return String(value || "").trim();
}

export function isChildRunEventData(eventData = {}, { rootSessionId = "" } = {}) {
  const normalizedRootSessionId = normalizeWsText(rootSessionId);
  const eventSessionId = normalizeWsText(eventData?.sessionId);
  const subAgentSessionId = normalizeWsText(eventData?.subAgentSessionId);
  const parentSessionId = normalizeWsText(eventData?.parentSessionId);
  return Boolean(
    eventData?.subAgentCall ||
      (eventSessionId && normalizedRootSessionId && eventSessionId !== normalizedRootSessionId) ||
      (subAgentSessionId && normalizedRootSessionId && subAgentSessionId !== normalizedRootSessionId) ||
      (parentSessionId && normalizedRootSessionId && parentSessionId === normalizedRootSessionId),
  );
}

export function parentOwnsChildRunEventData(eventData = {}, {
  rootSessionId = "",
  parentDialogProcessId = "",
} = {}) {
  const childSessionId = normalizeWsText(eventData?.sessionId || eventData?.subAgentSessionId);
  const childDialogProcessId = normalizeWsText(eventData?.dialogProcessId);
  const resolvedParentDialogProcessId = normalizeWsText(
    parentDialogProcessId || eventData?.parentDialogProcessId,
  );
  return {
    ...(eventData && typeof eventData === "object" ? eventData : {}),
    sessionId: normalizeWsText(rootSessionId),
    dialogProcessId: resolvedParentDialogProcessId,
    parentDialogProcessId: resolvedParentDialogProcessId,
    childSessionId,
    childDialogProcessId,
    subAgentCall: true,
    conversationStateOwner: "parent_agent",
  };
}

export function buildParentOwnedChildRunPayload(normalizedData = {}, parentOwnedData = {}, {
  rootSessionId = "",
  turnScopeId = "",
} = {}) {
  return {
    ...(normalizedData && typeof normalizedData === "object" ? normalizedData : {}),
    sessionId: normalizeWsText(rootSessionId),
    dialogProcessId: normalizeWsText(parentOwnedData?.dialogProcessId),
    parentDialogProcessId: normalizeWsText(parentOwnedData?.parentDialogProcessId),
    childSessionId: normalizeWsText(parentOwnedData?.childSessionId),
    childDialogProcessId: normalizeWsText(parentOwnedData?.childDialogProcessId),
    subAgentCall: true,
    conversationStateOwner: "parent_agent",
    turnScopeId: normalizeWsText(turnScopeId),
  };
}
