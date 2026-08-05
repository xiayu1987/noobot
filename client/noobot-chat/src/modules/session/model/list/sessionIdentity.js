/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findSessionByAnyId as findSessionByAnyIdInList } from "../../../chat/model/sessionIdentity.js";

export function normalizeSessionId(value = "") {
  return String(value || "").trim();
}

export function collectSessionIdentityIds(sessionItem = null) {
  const sessionId = normalizeSessionId(sessionItem?.sessionId);
  return sessionId ? [sessionId] : [];
}

export function createSessionIdentityHelpers({ sessions } = {}) {
  function isSameSessionIdentity(leftSessionId = "", rightSessionId = "") {
    const leftId = normalizeSessionId(leftSessionId);
    const rightId = normalizeSessionId(rightSessionId);
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;
    const leftSession = findSessionByAnyIdInList(sessions.value, leftId);
    const rightSession = findSessionByAnyIdInList(sessions.value, rightId);
    if (leftSession && rightSession && leftSession === rightSession) return true;
    const leftIds = collectSessionIdentityIds(leftSession);
    const rightIds = collectSessionIdentityIds(rightSession);
    return leftIds.some((id) => rightIds.includes(id));
  }

  return { isSameSessionIdentity };
}
