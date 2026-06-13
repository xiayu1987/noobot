/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findSessionByAnyId as findSessionByAnyIdInList,
  isCurrentActiveSessionId,
} from "../../infra/sessionIdentity";
import { _trimStr } from "./utils";

export function isCurrentActiveSession({ sessionId = "", activeSession, activeSessionId }) {
  return isCurrentActiveSessionId({
    sessionId,
    activeSession,
    activeSessionId,
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
    })
  ) {
    return true;
  }

  const targetSession = findSessionByAnyIdInList(sessions?.value, normalizedSessionId);
  if (!targetSession) {
    await chatList.fetchSessions(normalizedSessionId, {
      silent: true,
      preserveCurrentMessages: true,
    });
  }

  const resolvedTargetSession = findSessionByAnyIdInList(
    sessions?.value,
    normalizedSessionId,
  );
  if (!resolvedTargetSession) return false;

  await chatList.selectSession(resolvedTargetSession.id, {
    force: true,
    silent: true,
    preserveCurrentMessages: true,
  });

  return isCurrentActiveSession({
    sessionId: normalizedSessionId,
    activeSession: activeSession?.value,
    activeSessionId: activeSessionId?.value,
  });
}
