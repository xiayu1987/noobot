/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findLatestPendingAssistantAfterLastUser } from "../../infra/reconnectReplayModel";
import { _trimStr } from "./utils";

export function scheduleCacheExpiredSessionRefresh({
  getCacheExpiredRefreshTimer,
  setCacheExpiredRefreshTimer,
  replayCache,
  sending,
  canStop,
  interactionSubmitting,
  clearPendingInteraction,
  translate,
  activeSession,
  activeSessionId,
  chatList,
  applyAssistantFailureState,
  emitSyntheticErrorConversationState,
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
      sending.value = false;
      if (canStop) canStop.value = false;
      interactionSubmitting.value = false;
      clearPendingInteraction?.();
      const expiredErrorMessage = translate("chat.expiredRefreshFailed");
      const fallbackAssistantMessage =
        failedTargetAssistantMessage ||
        findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []);
      applyAssistantFailureState(fallbackAssistantMessage, expiredErrorMessage);
      emitSyntheticErrorConversationState({
        sessionId: _trimStr(failedSessionId || activeSession.value?.id),
        dialogProcessId: failedDialogProcessId,
        sourceEvent: "expired_refresh_failed",
      });
      notify?.({ type: "error", message: expiredErrorMessage });
    }

    Promise.resolve(
      chatList.fetchSessions(_trimStr(activeSessionId.value), {
        silent: true,
        preserveCurrentMessages: true,
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
