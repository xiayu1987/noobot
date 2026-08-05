/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { _trimStr } from "./utils.js";
import {
  logResendDebug,
  summarizeDebugMessages,
} from "../../../debug/loggers/resendDebugLogger.js";

function sessionIdentity(value = {}) {
  return _trimStr(value?.sessionId);
}

export function resolveMatchingSessionDetail(detail, sessionId = "") {
  const expectedSessionId = _trimStr(sessionId);
  if (!expectedSessionId || !detail || typeof detail !== "object") return null;
  const detailSessionId = sessionIdentity(detail);
  if (detailSessionId && detailSessionId !== expectedSessionId) return null;
  const sessionDocs = Array.isArray(detail?.sessions) ? detail.sessions : [];
  return sessionDocs.find((sessionDoc) => sessionIdentity(sessionDoc) === expectedSessionId) || null;
}

export async function renderActiveSessionBeforeReplay({
  activeSession,
  chatList,
  getReplayHydrationPromise = () => null,
  setReplayHydrationPromise = () => {},
  onError = () => {},
} = {}) {
  if (!activeSession?.value) return false;
  const existingPromise = getReplayHydrationPromise();
  if (existingPromise) return existingPromise;
  const sessionId = String(activeSession.value?.sessionId || "").trim();
  if (
    !sessionId ||
    typeof chatList?.fetchSessionDetail !== "function" ||
    typeof chatList?.applySessionDetail !== "function"
  ) {
    return false;
  }
  const hydrationPromise = (async () => {
    try {
      const detail = await chatList.fetchSessionDetail(sessionId, {
        source: "reconnectProtocolReconcile",
      });
      const matchingSessionDoc = resolveMatchingSessionDetail(detail, sessionId);
      const currentActiveSessionId = sessionIdentity(activeSession?.value);
      if (!matchingSessionDoc || currentActiveSessionId !== sessionId) {
        logResendDebug("hydration.detail.rejected", () => ({
          sessionId: sessionId,
          currentActiveSessionId,
          detailSessionId: sessionIdentity(detail),
          reason: !matchingSessionDoc ? "identity_mismatch_or_empty" : "active_session_changed",
        }));
        return false;
      }
      logResendDebug("hydration.detail.apply.before", () => ({
        sessionId: sessionId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      chatList.applySessionDetail(detail);
      logResendDebug("hydration.detail.apply.after", () => ({
        sessionId: sessionId,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
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
