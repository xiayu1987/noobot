/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomBytes } from "node:crypto";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";

const USER_INTERACTION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Builds the user-interaction bridge plus a helper to reject all pending
 * requests. Shared connection state is read through the provided accessors so
 * the extracted logic keeps observing live locale/run metadata updates.
 */
export function createUserInteractionBridge({
  sendEvent,
  translateText,
  getCurrentLocale = () => "",
  getCurrentRunMeta = () => null,
  pendingInteractionRequests,
  sessionLogConfig,
} = {}) {
  const rejectAllPendingInteractions = (error) => {
    const currentRunMeta = getCurrentRunMeta();
    for (const [, requestItem] of pendingInteractionRequests.entries()) {
      try {
        requestItem?.reject?.(error);
      } catch (rejectError) {
        void writeRoutedRuntimeEvent({
          source: "service",
          channel: RUNTIME_EVENT_CHANNELS.DIRECT,
          category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
          level: "warn",
          event: "service.websocket.pendingInteraction.reject.failed",
          userId: currentRunMeta?.userId || "",
          sessionId: currentRunMeta?.sessionId || "",
          dialogProcessId: currentRunMeta?.dialogProcessId || "",
          turnScopeId: currentRunMeta?.turnScopeId || "",
          error: rejectError,
        }, sessionLogConfig);
      }
      clearTimeout(requestItem?.timer);
    }
    pendingInteractionRequests.clear();
  };

  const userInteractionBridge = {
    requestUserInteraction: ({
      content = "",
      fields = [],
      dialogProcessId = "",
      requireEncryption = false,
      sessionId = "",
      toolName = "",
      needConnectionInfo = false,
      connectorName = "",
      connectorType = "",
      interactionType = "",
      interactionData = {},
      lifecycle = "pending",
      ackMode = "manual",
      resolvedBy = "",
      notification = {},
    } = {}) =>
      new Promise((resolveInteraction, rejectInteraction) => {
        const requestId = randomBytes(12).toString("hex");
        const timer = setTimeout(() => {
          pendingInteractionRequests.delete(requestId);
          rejectInteraction(new Error(translateText("ws.userInteractionTimeout", getCurrentLocale())));
        }, USER_INTERACTION_TIMEOUT_MS);

        pendingInteractionRequests.set(requestId, {
          resolve: resolveInteraction,
          reject: rejectInteraction,
          timer,
        });

        sendEvent("interaction_request", {
          requestId,
          content: String(content || ""),
          fields: Array.isArray(fields) ? fields : [],
          dialogProcessId: String(dialogProcessId || ""),
          requireEncryption: Boolean(requireEncryption),
          sessionId: String(sessionId || "").trim(),
          toolName: String(toolName || "").trim(),
          needConnectionInfo: Boolean(needConnectionInfo),
          connectorName: String(connectorName || "").trim(),
          connectorType: String(connectorType || "").trim(),
          interactionType: String(interactionType || "").trim(),
          lifecycle: String(lifecycle || "").trim().toLowerCase() || "pending",
          ackMode: String(ackMode || "").trim().toLowerCase() || "manual",
          resolvedBy: String(resolvedBy || "").trim().toLowerCase(),
          notification:
            notification && typeof notification === "object" && !Array.isArray(notification)
              ? notification
              : {},
          interactionData:
            interactionData && typeof interactionData === "object"
              ? interactionData
              : {},
        });
      }),
    emitNotification: ({ eventName = "notification", data = {} } = {}) => {
      const normalizedEventName =
        String(eventName || "").trim().toLowerCase() || "notification";
      const payload = data && typeof data === "object" ? data : {};
      sendEvent(normalizedEventName, payload);
      return Promise.resolve({
        ok: true,
        event: normalizedEventName,
      });
    },
  };

  return { userInteractionBridge, rejectAllPendingInteractions };
}
