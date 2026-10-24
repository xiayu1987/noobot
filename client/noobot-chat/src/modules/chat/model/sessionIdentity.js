/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

function normalizeSessionId(sessionId = "") {
  return text(sessionId);
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

function confirmSessionIdentity({ sessionItem, sessionId = "", activeSessionId = "" } = {}) {
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
  normalizeSessionId,
  confirmSessionIdentity,
  resolveSessionPrimaryId,
};
