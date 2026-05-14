/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function getSessionIdentityList(sessionItem = {}) {
  return [sessionItem?.id, sessionItem?.backendSessionId]
    .map(normalizeSessionId)
    .filter(Boolean);
}

function buildSessionIdentityMap(sessionItems = []) {
  const output = new Map();
  for (const sessionItem of Array.isArray(sessionItems) ? sessionItems : []) {
    for (const sessionId of getSessionIdentityList(sessionItem)) {
      output.set(sessionId, sessionItem);
    }
  }
  return output;
}

function findSessionByAnyId(sessionItems = [], sessionId = "") {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return null;
  return (
    (Array.isArray(sessionItems) ? sessionItems : []).find((sessionItem) =>
      getSessionIdentityList(sessionItem).includes(normalizedSessionId),
    ) || null
  );
}

function resolveSessionPrimaryId(sessionItems = [], sessionId = "") {
  const targetSession = findSessionByAnyId(sessionItems, sessionId);
  return normalizeSessionId(targetSession?.id || sessionId);
}

function isSessionIdInIdentity(sessionItem = {}, sessionId = "") {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return false;
  return getSessionIdentityList(sessionItem).includes(normalizedSessionId);
}

function getActiveSessionIdCandidates({ activeSession, activeSessionId } = {}) {
  return new Set(
    [activeSession?.backendSessionId, activeSession?.id, activeSessionId]
      .map(normalizeSessionId)
      .filter(Boolean),
  );
}

function isCurrentActiveSessionId({
  sessionId = "",
  activeSession,
  activeSessionId = "",
} = {}) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return false;
  return getActiveSessionIdCandidates({ activeSession, activeSessionId }).has(
    normalizedSessionId,
  );
}

function promoteSessionIdentityToBackendId({
  sessionItem,
  backendSessionId = "",
  activeSessionId = "",
} = {}) {
  const normalizedBackendSessionId = normalizeSessionId(backendSessionId);
  if (!sessionItem || !normalizedBackendSessionId) {
    return { changed: false, nextActiveSessionId: activeSessionId };
  }

  const previousSessionId = normalizeSessionId(sessionItem.id);
  const wasActive = getSessionIdentityList(sessionItem).includes(
    normalizeSessionId(activeSessionId),
  );

  sessionItem.backendSessionId = normalizedBackendSessionId;
  sessionItem.isLocal = false;

  if (previousSessionId !== normalizedBackendSessionId) {
    sessionItem.id = normalizedBackendSessionId;
    return {
      changed: true,
      nextActiveSessionId: wasActive ? normalizedBackendSessionId : activeSessionId,
    };
  }

  return { changed: false, nextActiveSessionId: activeSessionId };
}

export {
  buildSessionIdentityMap,
  findSessionByAnyId,
  getActiveSessionIdCandidates,
  getSessionIdentityList,
  isCurrentActiveSessionId,
  isSessionIdInIdentity,
  normalizeSessionId,
  promoteSessionIdentityToBackendId,
  resolveSessionPrimaryId,
};
