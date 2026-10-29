/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";

export async function renderActiveSessionBeforeReplay({
  activeSession,
  chatList,
  getReplayHydrationPromise,
  setReplayHydrationPromise,
  onError,
}) {
  const existingPromise = getReplayHydrationPromise();
  if (existingPromise) return existingPromise;
  const { sessionId } = activeSession.value;
  if (!sessionId) return false;
  const hydrationPromise = (async () => {
    try {
      const detail = await chatList.fetchSessionDetail(sessionId, {
        source: "reconnectProtocolReconcile",
      });
      const currentActiveSessionId = activeSession.value.sessionId;
      if (!detail.exists || currentActiveSessionId !== sessionId) {
        logResendDebug("hydration.detail.rejected", () => ({
          sessionId,
          currentActiveSessionId,
          reason: detail.exists ? "active_session_changed" : "session_missing",
        }));
        return false;
      }
      logResendDebug("hydration.detail.apply.before", () => ({
        sessionId,
        messages: summarizeDebugMessages(activeSession.value.messages),
      }));
      chatList.applySessionDetail(detail);
      logResendDebug("hydration.detail.apply.after", () => ({
        sessionId,
        messages: summarizeDebugMessages(activeSession.value.messages),
      }));
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      setReplayHydrationPromise(null);
    }
  })();
  setReplayHydrationPromise(hydrationPromise);
  return hydrationPromise;
}
