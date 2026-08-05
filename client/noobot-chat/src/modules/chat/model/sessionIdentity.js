/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function getSessionIdentityList(sessionItem = {}) {
  const sessionId = normalizeSessionId(sessionItem?.sessionId);
  return sessionId ? [sessionId] : [];
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
  return normalizeSessionId(targetSession?.sessionId || sessionId);
}

function isSessionIdInIdentity(sessionItem = {}, sessionId = "") {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return false;
  return getSessionIdentityList(sessionItem).includes(normalizedSessionId);
}

function getActiveSessionIdCandidates({ activeSession, activeSessionId } = {}) {
  return new Set(
    [activeSession?.sessionId, activeSessionId]
      .map(normalizeSessionId)
      .filter(Boolean),
  );
}

function isCurrentActiveSessionId({
  sessionId = "",
  activeSession,
  activeSessionId = "",
  sessionItems = [],
} = {}) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) return false;
  const activeCandidates = getActiveSessionIdCandidates({ activeSession, activeSessionId });
  if (activeCandidates.has(normalizedSessionId)) return true;

  const targetSession = findSessionByAnyId(sessionItems, normalizedSessionId);
  return getSessionIdentityList(targetSession).some((candidate) =>
    activeCandidates.has(candidate),
  );
}

function confirmSessionIdentity({
  sessionItem,
  sessionId = "",
  activeSessionId = "",
} = {}) {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!sessionItem || !normalizedSessionId) {
    return { changed: false, nextActiveSessionId: activeSessionId };
  }

  if (sessionItem.sessionId !== normalizedSessionId) {
    throw new Error("session identity mismatch");
  }
  sessionItem.isLocal = false;
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
  confirmSessionIdentity,
  resolveSessionPrimaryId,
};
