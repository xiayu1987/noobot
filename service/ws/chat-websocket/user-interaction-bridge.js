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
  validateInteractionAuthority,
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

function normalizeInteractionAuthority(authority = {}) {
  const validation = validateInteractionAuthority(authority);
  if (!validation.valid) {
    throw new TypeError(`invalid user interaction authority: ${validation.errors.join(",")}`);
  }
  return validation.authority;
}

async function handleInteractionTimeout({
  requestItem,
  requestId,
  interactionId,
  interactionIdentityKey,
  interactionAuthority,
  effectiveTimeoutMs,
  pendingInteractionRequests,
  interactionRequestsByIdentity,
  translateText,
  getCurrentLocale,
  writeInteractionLifecycle,
  commitInteractionRequest,
  rejectInteraction,
}) {
  pendingInteractionRequests.delete(requestId);
  if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
  requestItem.state = "rejected";
  const error = new Error(translateText("ws.userInteractionTimeout", getCurrentLocale()));
  writeInteractionLifecycle(
    "service.websocket.interaction.failed",
    { interactionId, requestId, reason: "timeout", timeoutMs: effectiveTimeoutMs },
    interactionAuthority,
  );
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
      userId: interactionAuthority.session.userId,
      parentSessionId: interactionAuthority.session.parentSessionId,
      persistenceScope: interactionAuthority.persistenceScope,
      payload: terminalPayload,
    });
  } catch (commitError) {
    writeInteractionLifecycle(
      "service.websocket.interaction.terminalCommitFailed",
      {
        interactionId,
        requestId,
        reason: commitError?.message || "interaction_authority_commit_failed",
      },
      interactionAuthority,
    );
  }
  writeInteractionLifecycle(
    "service.websocket.interaction.terminalSent",
    {
      interactionId,
      requestId,
      lifecycle: "failed",
      reason: "timeout",
      timeoutMs: effectiveTimeoutMs,
      sendStarted: true,
    },
    interactionAuthority,
  );
  rejectInteraction(error);
}

function createInteractionPayload(input, authority, requestId, effectiveTimeoutMs) {
  return {
    interactionId: String(input.interactionId || "").trim(),
    requestId,
    content: String(input.content || ""),
    fields: Array.isArray(input.fields) ? input.fields : [],
    dialogProcessId: authority.turn.dialogProcessId,
    requireEncryption: Boolean(input.requireEncryption),
    sessionId: authority.session.sessionId,
    turnScopeId: authority.turn.turnScopeId,
    toolName: String(input.toolName || "").trim(),
    needConnectionInfo: Boolean(input.needConnectionInfo),
    connectorName: String(input.connectorName || "").trim(),
    connectorType: String(input.connectorType || "").trim(),
    interactionType: String(input.interactionType || "").trim(),
    lifecycle:
      String(input.lifecycle || "")
        .trim()
        .toLowerCase() || "pending",
    ackMode:
      String(input.ackMode || "")
        .trim()
        .toLowerCase() || "manual",
    resolvedBy: String(input.resolvedBy || "")
      .trim()
      .toLowerCase(),
    notification:
      input.notification &&
      typeof input.notification === "object" &&
      !Array.isArray(input.notification)
        ? input.notification
        : {},
    timeoutMs: effectiveTimeoutMs,
    interactionData:
      input.interactionData && typeof input.interactionData === "object"
        ? input.interactionData
        : {},
  };
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
  if (typeof commitInteractionRequest !== "function") {
    throw new TypeError("commitInteractionRequest is required");
  }
  const interactionRequestsByIdentity = new Map();
  const writeInteractionLifecycle = (event, data, authority) => {
    void writeRoutedRuntimeEvent(
      {
        source: "service",
        channel: RUNTIME_EVENT_CHANNELS.DIRECT,
        category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
        event,
        userId: authority.session.userId,
        sessionId: authority.session.sessionId,
        dialogProcessId: authority.turn.dialogProcessId,
        turnScopeId: authority.turn.turnScopeId,
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
    requestUserInteraction: (input = {}) => {
      const interactionAuthority = normalizeInteractionAuthority(input.authority);
      const { interactionId = "", timeoutMs = undefined } = input;
      const normalizedInteractionId = String(interactionId || "").trim();
      const normalizedSessionId = interactionAuthority.session.sessionId;
      const interactionIdentityKey = normalizedInteractionId
        ? `${normalizedSessionId}::${normalizedInteractionId}`
        : "";
      const existingRequest = interactionIdentityKey
        ? interactionRequestsByIdentity.get(interactionIdentityKey)
        : null;
      if (existingRequest) {
        writeInteractionLifecycle(
          "service.websocket.interaction.deduplicated",
          {
            interactionId: normalizedInteractionId,
            requestId: existingRequest.requestId,
            state: existingRequest.state,
          },
          interactionAuthority,
        );
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
        const timer = setTimeout(
          () =>
            handleInteractionTimeout({
              requestItem,
              requestId,
              interactionId: normalizedInteractionId,
              interactionIdentityKey,
              interactionAuthority,
              effectiveTimeoutMs,
              pendingInteractionRequests,
              interactionRequestsByIdentity,
              translateText,
              getCurrentLocale,
              writeInteractionLifecycle,
              commitInteractionRequest,
              rejectInteraction,
            }),
          effectiveTimeoutMs,
        );

        requestItem.timer = timer;
        writeInteractionLifecycle(
          "service.websocket.interaction.timeoutScheduled",
          {
            interactionId: normalizedInteractionId,
            requestId,
            timeoutMs: effectiveTimeoutMs,
          },
          interactionAuthority,
        );
        requestItem.resolve = (response) => {
          clearTimeout(requestItem.timer);
          pendingInteractionRequests.delete(requestId);
          requestItem.state = "resolved";
          requestItem.result = response;
          writeInteractionLifecycle(
            "service.websocket.interaction.resolved",
            { interactionId: normalizedInteractionId, requestId },
            interactionAuthority,
          );
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

        requestItem.payload = createInteractionPayload(
          input,
          interactionAuthority,
          requestId,
          effectiveTimeoutMs,
        );
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
          userId: interactionAuthority.session.userId,
          parentSessionId: interactionAuthority.session.parentSessionId,
          persistenceScope: interactionAuthority.persistenceScope,
          payload: requestItem.payload,
        }).catch((error) => {
          pendingInteractionRequests.delete(requestId);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          clearTimeout(requestItem.timer);
          requestItem.state = "rejected";
          rejectInteraction(error);
        });
        writeInteractionLifecycle(
          "service.websocket.interaction.registered",
          { interactionId: normalizedInteractionId, requestId },
          interactionAuthority,
        );
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
