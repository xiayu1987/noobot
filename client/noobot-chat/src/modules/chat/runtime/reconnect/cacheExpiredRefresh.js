/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils.js";

export function scheduleCacheExpiredSessionRefresh({
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
  replayCache,
  interactionSubmitting,
  clearPendingInteraction,
  translate,
  activeSession,
  activeSessionId,
  chatList,
  applyRunStateEvent,
  applyAssistantFailureState,
  notify,
  sessionId = "",
  dialogProcessId = "",
  targetAssistantMessage = null,
} = {}) {
  const currentTimer = getCacheExpiredRefreshTimer?.();
  if (currentTimer) clearTimeout(currentTimer);
  const refreshTimer = setTimeout(() => {
    setCacheExpiredRefreshTimer?.(null);
    Object.keys(replayCache || {}).forEach((sessionKey) => {
      delete replayCache[sessionKey];
    });

    function handleExpiredRefreshError({
      sessionId: failedSessionId = "",
      dialogProcessId: failedDialogProcessId = "",
      targetAssistantMessage: failedTargetAssistantMessage = null,
    } = {}) {
      const normalizedFailedSessionId = _trimStr(failedSessionId || activeSession.value?.id);
      interactionSubmitting.value = false;
      clearPendingInteraction?.();
      const expiredErrorMessage = translate("chat.expiredRefreshFailed");
      notify?.({ type: "error", message: expiredErrorMessage });
    }

    Promise.resolve(
      chatList.fetchSessions(_trimStr(activeSessionId.value), {
        silent: true,
        forceCurrentSessionRerender: true,
      }),
    )
      .then((ok) => {
        if (ok !== false) return;
        handleExpiredRefreshError({ sessionId, dialogProcessId, targetAssistantMessage });
      })
      .catch(() => {
        handleExpiredRefreshError({ sessionId, dialogProcessId, targetAssistantMessage });
      });
  }, 1200);
  setCacheExpiredRefreshTimer?.(refreshTimer);
}
