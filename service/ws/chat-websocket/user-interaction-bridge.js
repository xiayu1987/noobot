/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash, randomBytes } from "node:crypto";
import { resolveUserInteractionTimeoutMs } from "@noobot/shared/time-thresholds";
import {
  RUNTIME_EVENT_CATEGORIES,
  RUNTIME_EVENT_CHANNELS,
  writeRoutedRuntimeEvent,
} from "@noobot/runtime-events";
import {
  EVENT_TYPE,
  validateInteractionRequestPayload,
} from "@noobot/event-protocol";

const USER_INTERACTION_TIMEOUT_MS = resolveUserInteractionTimeoutMs();

export function createUserInteractionBridge({
  sendEvent,
  translateText,
  getCurrentLocale = () => "",
  getCurrentRunMeta = () => null,
  pendingInteractionRequests,
  sessionLogConfig,
  interactionTimeoutMs = USER_INTERACTION_TIMEOUT_MS,
} = {}) {
  const interactionRequestsByIdentity = new Map();
  const writeInteractionLifecycle = (event, data = {}) => {
    const currentRunMeta = getCurrentRunMeta();
    void writeRoutedRuntimeEvent({
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
      event,
      userId: currentRunMeta?.userId || "",
      sessionId: currentRunMeta?.sessionId || "",
      dialogProcessId: currentRunMeta?.dialogProcessId || "",
      turnScopeId: currentRunMeta?.turnScopeId || "",
      data,
    }, sessionLogConfig);
  };
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
    interactionRequestsByIdentity.clear();
  };

  const userInteractionBridge = {
    requestUserInteraction: ({
      interactionId = "",
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
      turnScopeId = "",
      lifecycle = "pending",
      ackMode = "manual",
      resolvedBy = "",
      notification = {},
    } = {}) => {
      const normalizedInteractionId = String(interactionId || "").trim();
      const currentRunMeta = getCurrentRunMeta() || {};
      const normalizedSessionId = String(sessionId || currentRunMeta.sessionId || "").trim();
      const normalizedDialogProcessId = String(
        dialogProcessId || currentRunMeta.dialogProcessId || "",
      ).trim();
      const normalizedTurnScopeId = String(
        turnScopeId || currentRunMeta.turnScopeId || "",
      ).trim();
      const interactionIdentityKey = normalizedInteractionId
        ? `${normalizedSessionId}::${normalizedInteractionId}`
        : "";
      const existingRequest = interactionIdentityKey
        ? interactionRequestsByIdentity.get(interactionIdentityKey)
        : null;
      if (existingRequest) {
        writeInteractionLifecycle("service.websocket.interaction.deduplicated", {
          interactionId: normalizedInteractionId,
          requestId: existingRequest.requestId,
          state: existingRequest.state,
        });
        return existingRequest.promise;
      }

      const requestId = normalizedInteractionId
        ? createHash("sha256")
            .update(`${normalizedSessionId}:${normalizedInteractionId}`)
            .digest("hex")
            .slice(0, 24)
        : randomBytes(12).toString("hex");
      const requestItem = {
        interactionId: normalizedInteractionId,
        requestId,
        state: "pending",
        result: undefined,
        promise: null,
        resolve: null,
        reject: null,
        timer: null,
        payload: null,
      };
      requestItem.promise = new Promise((resolveInteraction, rejectInteraction) => {
        const timer = setTimeout(() => {
          pendingInteractionRequests.delete(requestId);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          requestItem.state = "rejected";
          const error = new Error(translateText("ws.userInteractionTimeout", getCurrentLocale()));
          writeInteractionLifecycle("service.websocket.interaction.failed", {
            interactionId: normalizedInteractionId,
            requestId,
            reason: "timeout",
            timeoutMs: interactionTimeoutMs,
          });
          sendEvent(EVENT_TYPE.INTERACTION_REQUEST, {
            ...requestItem.payload,
            lifecycle: "failed",
            resolvedBy: "system",
            interactionData: {
              ...(requestItem.payload?.interactionData || {}),
              lifecycle: "failed",
              resolvedBy: "system",
              reason: "timeout",
              error: { code: "user_interaction_timeout", message: error.message },
            },
            notification: {
              enabled: true,
              level: "error",
              title: "User interaction failed",
              content: error.message,
              data: { reason: "timeout" },
            },
          });
          writeInteractionLifecycle("service.websocket.interaction.terminalSent", {
            interactionId: normalizedInteractionId,
            requestId,
            lifecycle: "failed",
            reason: "timeout",
            timeoutMs: interactionTimeoutMs,
            sendStarted: true,
          });
          rejectInteraction(error);
        }, interactionTimeoutMs);

        requestItem.timer = timer;
        writeInteractionLifecycle("service.websocket.interaction.timeoutScheduled", {
          interactionId: normalizedInteractionId,
          requestId,
          timeoutMs: interactionTimeoutMs,
        });
        requestItem.resolve = (response) => {
          requestItem.state = "resolved";
          requestItem.result = response;
          writeInteractionLifecycle("service.websocket.interaction.resolved", {
            interactionId: normalizedInteractionId,
            requestId,
          });
          resolveInteraction(response);
        };
        requestItem.reject = (error) => {
          requestItem.state = "rejected";
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          rejectInteraction(error);
        };
        pendingInteractionRequests.set(requestId, requestItem);
        if (interactionIdentityKey) {
          interactionRequestsByIdentity.set(interactionIdentityKey, requestItem);
        }

        requestItem.payload = {
          interactionId: normalizedInteractionId,
          requestId,
          content: String(content || ""),
          fields: Array.isArray(fields) ? fields : [],
          dialogProcessId: normalizedDialogProcessId,
          requireEncryption: Boolean(requireEncryption),
          sessionId: normalizedSessionId,
          turnScopeId: normalizedTurnScopeId,
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
        };
        const validation = validateInteractionRequestPayload(requestItem.payload);
        if (!validation.valid) {
          pendingInteractionRequests.delete(requestId);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          clearTimeout(requestItem.timer);
          requestItem.state = "rejected";
          rejectInteraction(new Error(`invalid interaction request: ${validation.reason}`));
          return;
        }
        sendEvent(EVENT_TYPE.INTERACTION_REQUEST, requestItem.payload);
        writeInteractionLifecycle("service.websocket.interaction.registered", {
          interactionId: normalizedInteractionId,
          requestId,
        });
      });
      return requestItem.promise;
    },
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
