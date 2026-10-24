/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findSessionByAnyId as findSessionByAnyIdInList } from "../../model/sessionIdentity.js";

export function isCurrentActiveSession(activeSession, sessionId) {
  return activeSession !== undefined && activeSession.sessionId === sessionId;
}

export async function ensureReconnectSessionActive({
  sessionId,
  sessions,
  activeSession,
  chatList,
}) {
  if (isCurrentActiveSession(activeSession.value, sessionId)) return true;

  if (!findSessionByAnyIdInList(sessions.value, sessionId)) {
    await chatList.fetchSessions(sessionId, {
      silent: true,
    });
  }

  const resolvedTargetSession = findSessionByAnyIdInList(sessions.value, sessionId);
  if (!resolvedTargetSession) return false;

  await chatList.selectSession(resolvedTargetSession.sessionId, {
    force: true,
    silent: true,
  });

  return isCurrentActiveSession(activeSession.value, sessionId);
}
