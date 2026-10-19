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
  writeRuntimeEvent,
} from "@noobot/runtime-events";
import {
  validateInteractionAuthority,
  validateInteractionRequestPayload,
} from "@noobot/event-protocol";
import {
  registerPendingInteraction,
  rejectPendingInteractionsForTurn,
  unregisterPendingInteraction,
} from "./pending-interaction-registry.js";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";

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
  interactionRequestsByIdentity,
  translateText,
  getCurrentLocale,
  commitInteractionRequest,
  rejectInteraction,
}) {
  unregisterPendingInteraction(requestItem);
  if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
  requestItem.state = "rejected";
  const error = new Error(translateText("ws.userInteractionTimeout", getCurrentLocale()));
  requestItem.recordLifecycle("service.websocket.interaction.failed", {
    interactionId,
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
      userId: interactionAuthority.session.userId,
      parentSessionId: interactionAuthority.session.parentSessionId,
      persistenceScope: interactionAuthority.persistenceScope,
      payload: terminalPayload,
    });
  } catch (commitError) {
    requestItem.recordLifecycle("service.websocket.interaction.terminalCommitFailed", {
      interactionId,
      requestId,
      reason: commitError?.message || "interaction_authority_commit_failed",
    });
  }
  requestItem.recordLifecycle("service.websocket.interaction.terminalSent", {
    interactionId,
    requestId,
    lifecycle: "failed",
    reason: "timeout",
    timeoutMs: effectiveTimeoutMs,
    sendStarted: true,
  });
  rejectInteraction(error);
}

async function settleAfterLifecycleWrites(settlement, requestItem) {
  const [outcome] = await Promise.allSettled([settlement]);
  const writeErrors = (await Promise.all(requestItem.lifecycleWrites)).filter(Boolean);
  if (outcome.status === "rejected") {
    if (!writeErrors.length) throw outcome.reason;
    throw new AggregateError([outcome.reason, ...writeErrors], outcome.reason?.message, {
      cause: outcome.reason,
    });
  }
  if (writeErrors.length) {
    throw new AggregateError(writeErrors, "user interaction lifecycle write failed");
  }
  return outcome.value;
}

function createInteractionPayload(input, authority, requestId, effectiveTimeoutMs) {
  return {
    interactionId: text(input.interactionId),
    requestId,
    content: String(input.content || ""),
    fields: Array.isArray(input.fields) ? input.fields : [],
    dialogProcessId: authority.turn.dialogProcessId,
    requireEncryption: Boolean(input.requireEncryption),
    sessionId: authority.session.sessionId,
    turnScopeId: authority.turn.turnScopeId,
    toolName: text(input.toolName),
    needConnectionInfo: Boolean(input.needConnectionInfo),
    connectorName: text(input.connectorName),
    connectorType: text(input.connectorType),
    interactionType: text(input.interactionType),
    lifecycle: text(input.lifecycle).toLowerCase() || "pending",
    ackMode: text(input.ackMode).toLowerCase() || "manual",
    resolvedBy: text(input.resolvedBy).toLowerCase(),
    notification: isPlainObject(input.notification) ? input.notification : {},
    timeoutMs: effectiveTimeoutMs,
    interactionData:
      input.interactionData && typeof input.interactionData === "object"
        ? input.interactionData
        : {},
  };
}

export function createUserInteractionBridge({
  ownerUserId,
  commitInteractionRequest,
  translateText,
  getCurrentLocale = () => "",
  interactionTimeoutMs = USER_INTERACTION_TIMEOUT_MS,
} = {}) {
  const interactionOwnerUserId = text(ownerUserId);
  if (!interactionOwnerUserId) throw new TypeError("ownerUserId is required");
  if (!isFunction(commitInteractionRequest)) {
    throw new TypeError("commitInteractionRequest is required");
  }
  const interactionRequestsByIdentity = new Map();
  const writeInteractionLifecycle = (event, data, authority) =>
    writeRuntimeEvent({
      scope: "session",
      source: "service",
      channel: RUNTIME_EVENT_CHANNELS.DIRECT,
      category: RUNTIME_EVENT_CATEGORIES.INTERACTION,
      event,
      userId: authority.session.userId,
      sessionId: authority.session.sessionId,
      dialogProcessId: authority.turn.dialogProcessId,
      turnScopeId: authority.turn.turnScopeId,
      data,
    });
  const rejectTurnInteractions = ({ sessionId = "", turnScopeId = "" } = {}, error) =>
    rejectPendingInteractionsForTurn(
      { ownerUserId: interactionOwnerUserId, sessionId, turnScopeId },
      error,
    );

  const userInteractionBridge = {
    requestUserInteraction: (input = {}) => {
      const interactionAuthority = normalizeInteractionAuthority(input.authority);
      const { interactionId = "", timeoutMs = undefined } = input;
      const normalizedInteractionId = text(interactionId);
      const normalizedSessionId = interactionAuthority.session.sessionId;
      const interactionIdentityKey = normalizedInteractionId
        ? `${normalizedSessionId}::${normalizedInteractionId}`
        : "";
      const existingRequest = interactionIdentityKey
        ? interactionRequestsByIdentity.get(interactionIdentityKey)
        : null;
      if (existingRequest) {
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
        lifecycleWrites: [],
        recordLifecycle: null,
        resolve: null,
        reject: null,
        timer: null,
        payload: null,
        ownerUserId: interactionOwnerUserId,
        sessionId: normalizedSessionId,
        turnScopeId: interactionAuthority.turn.turnScopeId,
      };
      const effectiveTimeoutMs = normalizeInteractionTimeoutMs(timeoutMs, interactionTimeoutMs);

      requestItem.recordLifecycle = (event, data) => {
        requestItem.lifecycleWrites.push(
          writeInteractionLifecycle(event, data, interactionAuthority).then(
            () => null,
            (error) => error,
          ),
        );
      };
      const settlement = new Promise((resolveInteraction, rejectInteraction) => {
        const timer = setTimeout(
          () =>
            void handleInteractionTimeout({
              requestItem,
              requestId,
              interactionId: normalizedInteractionId,
              interactionIdentityKey,
              interactionAuthority,
              effectiveTimeoutMs,
              interactionRequestsByIdentity,
              translateText,
              getCurrentLocale,
              commitInteractionRequest,
              rejectInteraction,
            }).catch(rejectInteraction),
          effectiveTimeoutMs,
        );

        requestItem.timer = timer;
        requestItem.resolve = (response) => {
          clearTimeout(requestItem.timer);
          unregisterPendingInteraction(requestItem);
          requestItem.state = "resolved";
          requestItem.result = response;
          requestItem.recordLifecycle("service.websocket.interaction.resolved", {
            interactionId: normalizedInteractionId,
            requestId,
          });
          resolveInteraction(response);
        };
        requestItem.reject = (error) => {
          clearTimeout(requestItem.timer);
          unregisterPendingInteraction(requestItem);
          requestItem.state = "rejected";
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          rejectInteraction(error);
        };
        requestItem.recordLifecycle("service.websocket.interaction.timeoutScheduled", {
          interactionId: normalizedInteractionId,
          requestId,
          timeoutMs: effectiveTimeoutMs,
        });
        registerPendingInteraction(requestItem);
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
          unregisterPendingInteraction(requestItem);
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
          unregisterPendingInteraction(requestItem);
          if (interactionIdentityKey) interactionRequestsByIdentity.delete(interactionIdentityKey);
          clearTimeout(requestItem.timer);
          requestItem.state = "rejected";
          rejectInteraction(error);
        });
        requestItem.recordLifecycle("service.websocket.interaction.registered", {
          interactionId: normalizedInteractionId,
          requestId,
        });
      });
      requestItem.promise = settleAfterLifecycleWrites(settlement, requestItem);
      return requestItem.promise;
    },
  };

  return { userInteractionBridge, rejectTurnInteractions };
}
