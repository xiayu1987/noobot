/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";

function resolveMatchingSessionDetail(detail, sessionId) {
  if (detail === null || detail.sessionId !== sessionId) return null;
  return detail.sessions.find((sessionDoc) => sessionDoc.sessionId === sessionId) || null;
}

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
      const matchingSessionDoc = resolveMatchingSessionDetail(detail, sessionId);
      const currentActiveSessionId = activeSession.value.sessionId;
      if (!matchingSessionDoc || currentActiveSessionId !== sessionId) {
        logResendDebug("hydration.detail.rejected", () => ({
          sessionId,
          currentActiveSessionId,
          detailSessionId: detail === null ? null : detail.sessionId,
          reason: !matchingSessionDoc ? "identity_mismatch_or_empty" : "active_session_changed",
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
