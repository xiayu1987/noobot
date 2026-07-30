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
  return _trimStr(value?.sessionId || value?.backendSessionId || value?.id);
}

export function resolveMatchingSessionDetail(detail, backendSessionId = "") {
  const expectedSessionId = _trimStr(backendSessionId);
  if (!expectedSessionId || !detail || typeof detail !== "object") return null;
  const detailSessionId = sessionIdentity(detail);
  if (detailSessionId && detailSessionId !== expectedSessionId) return null;
  const sessionDocs = Array.isArray(detail?.sessions) ? detail.sessions : [];
  return sessionDocs.find((sessionDoc) => sessionIdentity(sessionDoc) === expectedSessionId) || null;
}

export async function renderActiveSessionBeforeReplay({
  activeSession,
  activeSessionId,
  chatList,
  getReplayHydrationPromise = () => null,
  setReplayHydrationPromise = () => {},
  onError = () => {},
} = {}) {
  if (!activeSession?.value) return false;
  const existingPromise = getReplayHydrationPromise();
  if (existingPromise) return existingPromise;
  const backendSessionId = String(
    activeSession.value?.backendSessionId || activeSessionId?.value || "",
  ).trim();
  if (
    !backendSessionId ||
    typeof chatList?.fetchSessionDetail !== "function" ||
    typeof chatList?.applySessionDetail !== "function"
  ) {
    return false;
  }
  const hydrationPromise = (async () => {
    try {
      const detail = await chatList.fetchSessionDetail(backendSessionId, {
        source: "reconnectHydration",
        reuseRecentlyLoaded: false,
        allowLoadedSnapshot: false,
      });
      const matchingSessionDoc = resolveMatchingSessionDetail(detail, backendSessionId);
      const currentActiveSessionId = sessionIdentity(activeSession?.value);
      if (!matchingSessionDoc || currentActiveSessionId !== backendSessionId) {
        logResendDebug("hydration.detail.rejected", () => ({
          sessionId: backendSessionId,
          currentActiveSessionId,
          detailSessionId: sessionIdentity(detail),
          reason: !matchingSessionDoc ? "identity_mismatch_or_empty" : "active_session_changed",
        }));
        return false;
      }
      logResendDebug("hydration.detail.apply.before", () => ({
        sessionId: backendSessionId,
        preserveCurrentMessages: true,
        messages: summarizeDebugMessages(activeSession?.value?.messages),
      }));
      chatList.applySessionDetail(detail, { preserveCurrentMessages: true });
      logResendDebug("hydration.detail.apply.after", () => ({
        sessionId: backendSessionId,
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

