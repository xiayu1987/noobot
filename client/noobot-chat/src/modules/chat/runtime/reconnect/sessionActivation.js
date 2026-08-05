/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  isCurrentActiveSessionId,
} from "../../model/sessionIdentity.js";
import { _trimStr } from "./utils.js";

export function isCurrentActiveSession({
  sessionId = "",
  activeSession,
  activeSessionId,
  sessions = [],
}) {
  return isCurrentActiveSessionId({
    sessionId,
    activeSession,
    activeSessionId,
    sessionItems: sessions,
  });
}

export async function ensureReconnectSessionActive({
  sessionId = "",
  sessions,
  activeSession,
  activeSessionId,
  chatList,
}) {
  const normalizedSessionId = _trimStr(sessionId);
  if (
    !normalizedSessionId ||
    isCurrentActiveSession({
      sessionId: normalizedSessionId,
      activeSession: activeSession?.value,
      activeSessionId: activeSessionId?.value,
      sessions: sessions?.value,
    })
  ) {
    return true;
  }

  const targetSession = findSessionByAnyIdInList(sessions?.value, normalizedSessionId);
  if (!targetSession) {
    await chatList.fetchSessions(normalizedSessionId, {
      silent: true,
    });
  }

  const resolvedTargetSession = findSessionByAnyIdInList(
    sessions?.value,
    normalizedSessionId,
  );
  if (!resolvedTargetSession) return false;

  await chatList.selectSession(resolvedTargetSession.sessionId, {
    force: true,
    silent: true,
  });

  return isCurrentActiveSession({
    sessionId: normalizedSessionId,
    activeSession: activeSession?.value,
    activeSessionId: activeSessionId?.value,
    sessions: sessions?.value,
  });
}
