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
  validateInteractionRequestPayload,
} from "@noobot/event-protocol";

const USER_INTERACTION_TIMEOUT_MS = resolveUserInteractionTimeoutMs();

function normalizeInteractionTimeoutMs(timeoutMs, fallbackTimeoutMs = USER_INTERACTION_TIMEOUT_MS) {
  const normalizedFallbackTimeoutMs =
    Number.isInteger(fallbackTimeoutMs) && fallbackTimeoutMs > 0
      ? fallbackTimeoutMs
      : USER_INTERACTION_TIMEOUT_MS;
  const normalizedTimeoutMs = Number(timeoutMs);
  if (!Number.isInteger(normalizedTimeoutMs) || normalizedTimeoutMs <= 0) {
    return normalizedFallbackTimeoutMs;
  }
  return Math.min(normalizedTimeoutMs, normalizedFallbackTimeoutMs);
}

export function createUserInteractionBridge({
  sendEvent,
  commitInteractionRequest,
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
    void writeRoutedRuntimeEvent(
      {
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
        event,
        userId: currentRunMeta?.userId || "",
        sessionId: currentRunMeta?.sessionId || "",
        dialogProcessId: currentRunMeta?.dialogProcessId || "",
        turnScopeId: currentRunMeta?.turnScopeId || "",
        data,
      },
      sessionLogConfig,
    );
  };
  const rejectAllPendingInteractions = (error) => {
    const currentRunMeta = getCurrentRunMeta();
    for (const [, requestItem] of pendingInteractionRequests.entries()) {
      try {
        requestItem?.reject?.(error);
      } catch (rejectError) {
        void writeRoutedRuntimeEvent(
          {
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
          },
          sessionLogConfig,
        );
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
      timeoutMs = undefined,
    } = {}) => {
      const normalizedInteractionId = String(interactionId || "").trim();
      const currentRunMeta = getCurrentRunMeta() || {};
      const normalizedSessionId = String(sessionId || currentRunMeta.sessionId || "").trim();
      const normalizedDialogProcessId = String(
        dialogProcessId || currentRunMeta.dialogProcessId || "",
      ).trim();
      const normalizedTurnScopeId = String(turnScopeId || currentRunMeta.turnScopeId || "").trim();
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
      const effectiveTimeoutMs = normalizeInteractionTimeoutMs(timeoutMs, interactionTimeoutMs);
      requestItem.promise = new Promise((resolveInteraction, rejectInteraction) => {
        const timer = setTimeout(async () => {
          pendingInteractionRequests.delete(requestId);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          requestItem.state = "rejected";
          const error = new Error(translateText("ws.userInteractionTimeout", getCurrentLocale()));
          writeInteractionLifecycle("service.websocket.interaction.failed", {
            interactionId: normalizedInteractionId,
            requestId,
            reason: "timeout",
            timeoutMs: effectiveTimeoutMs,
          });
          const terminalPayload = {
            ...requestItem.payload,
            lifecycle: "failed",
            resolvedBy: "system",
            interactionData: {
              ...(requestItem.payload?.interactionData || {}),
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
          };
          try {
            await commitInteractionRequest({
              userId: currentRunMeta.userId,
              parentSessionId: currentRunMeta.parentSessionId,
              persistenceScope: currentRunMeta.persistenceScope,
              payload: terminalPayload,
            });
          } catch (commitError) {
            writeInteractionLifecycle("service.websocket.interaction.terminalCommitFailed", {
              interactionId: normalizedInteractionId,
              requestId,
              reason: commitError?.message || "interaction_authority_commit_failed",
            });
          }
          writeInteractionLifecycle("service.websocket.interaction.terminalSent", {
            interactionId: normalizedInteractionId,
            requestId,
            lifecycle: "failed",
            reason: "timeout",
            timeoutMs: effectiveTimeoutMs,
            sendStarted: true,
          });
          rejectInteraction(error);
        }, effectiveTimeoutMs);

        requestItem.timer = timer;
        writeInteractionLifecycle("service.websocket.interaction.timeoutScheduled", {
          interactionId: normalizedInteractionId,
          requestId,
          timeoutMs: effectiveTimeoutMs,
        });
        requestItem.resolve = (response) => {
          clearTimeout(requestItem.timer);
          pendingInteractionRequests.delete(requestId);
          requestItem.state = "resolved";
          requestItem.result = response;
          writeInteractionLifecycle("service.websocket.interaction.resolved", {
            interactionId: normalizedInteractionId,
            requestId,
          });
          resolveInteraction(response);
        };
        requestItem.reject = (error) => {
          clearTimeout(requestItem.timer);
          pendingInteractionRequests.delete(requestId);
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
          lifecycle:
            String(lifecycle || "")
              .trim()
              .toLowerCase() || "pending",
          ackMode:
            String(ackMode || "")
              .trim()
              .toLowerCase() || "manual",
          resolvedBy: String(resolvedBy || "")
            .trim()
            .toLowerCase(),
          notification:
            notification && typeof notification === "object" && !Array.isArray(notification)
              ? notification
              : {},
          timeoutMs: effectiveTimeoutMs,
          interactionData:
            interactionData && typeof interactionData === "object" ? interactionData : {},
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
        void commitInteractionRequest({
          userId: currentRunMeta.userId,
          parentSessionId: currentRunMeta.parentSessionId,
          persistenceScope: currentRunMeta.persistenceScope,
          payload: requestItem.payload,
        }).catch((error) => {
          pendingInteractionRequests.delete(requestId);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          clearTimeout(requestItem.timer);
          requestItem.state = "rejected";
          rejectInteraction(error);
        });
        writeInteractionLifecycle("service.websocket.interaction.registered", {
          interactionId: normalizedInteractionId,
          requestId,
        });
      });
      return requestItem.promise;
    },
    emitNotification: ({ eventName = "notification", data = {} } = {}) => {
      const normalizedEventName =
        String(eventName || "")
          .trim()
          .toLowerCase() || "notification";
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
