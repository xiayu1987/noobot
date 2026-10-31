/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function findReconnectTargetSessionId(sessions, targetSessionId) {
  if (
    targetSessionId &&
    sessions.some((sessionEntry) => sessionEntry.sessionId === targetSessionId)
  ) {
    return targetSessionId;
  }
  return "";
}

export { findReconnectTargetSessionId };
