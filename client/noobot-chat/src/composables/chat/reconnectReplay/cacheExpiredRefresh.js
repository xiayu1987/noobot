/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { findLatestPendingAssistantAfterLastUser } from "../../infra/reconnectReplayModel";
import { BackendChannelState, SESSION_RUN_EVENT } from "../sessionRunStateMachine";
import { _trimStr } from "./utils";

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
      const normalizedFailedSessionId = _trimStr(failedSessionId || activeSession.value?.id);
      applyRunStateEvent?.({
          type: SESSION_RUN_EVENT.LOCAL_FAILURE,
          state: BackendChannelState.ERROR,
          sessionId: normalizedFailedSessionId,
          dialogProcessId: failedDialogProcessId,
          source: "expired_refresh_failed",
      });
      interactionSubmitting.value = false;
      clearPendingInteraction?.();
      const expiredErrorMessage = translate("chat.expiredRefreshFailed");
      const fallbackAssistantMessage =
        failedTargetAssistantMessage ||
        findLatestPendingAssistantAfterLastUser(activeSession.value?.messages || []);
      applyAssistantFailureState(fallbackAssistantMessage, expiredErrorMessage);
      emitSyntheticErrorConversationState({
        sessionId: normalizedFailedSessionId,
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
