/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
  resolveConnectorConnectedPayload,
} from "../interactionPayload";
import {
  isBlankCompatibleSameId,
  isInFlightConversationState,
  isTerminalConversationState,
  normalizePendingInteractionPayloads,
  normalizeTrimmedString,
} from "./utils";
import {
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
} from "../sessionRunStateMachine";

export function createChatEngineConversationState({
  activeSession,
  activeSessionId,
  sending,
  canStop,
  applyRunStateEvent,
  interactionSubmitting,
  pendingInteractionRequest,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  refreshSessionsAsync,
  onConversationState,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  notify,
  translate,
  applyAssistantFailureState,
} = {}) {
  let cacheExpiredRefreshTimer = null;
  const missingInteractionPayloadTimers = new Map();
  const connectorConnectedAckedRequestIds = new Set();

  function tryAutoResolveInteraction(rawRequest = {}) {
    const request = normalizeInteractionRequestPayload(rawRequest || {});
    if (!isAutoResolvedInteraction(request)) {
      return false;
    }
    const requestId = String(request?.requestId || "").trim();
    if (requestId && connectorConnectedAckedRequestIds.has(requestId)) {
      return true;
    }
    if (String(request?.interactionType || "").trim() === "connector_connected") {
      const { connectorType, connectorName, status } = resolveConnectorConnectedPayload(request);
      if (connectorTypeSet?.has?.(connectorType) && connectorName) {
        upsertConnectedConnectorInPanelState(activeSession.value, {
          connectorType,
          connectorName,
          status,
        });
        refreshSessionConnectorsAsync(activeSession.value?.id || "");
      }
    }
    try {
      if (request?.requestId) {
        submitInteractionResponse(
          {
            confirmed: true,
            response: String(request?.interactionType || "").trim()
              ? `${String(request.interactionType).trim()}_ack`
              : "interaction_auto_ack",
          },
          {
            requestId: request.requestId,
            requireEncryption: request.requireEncryption === true,
            sessionId: String(request.sessionId || ""),
          },
        );
      }
    } catch {}
    if (requestId) connectorConnectedAckedRequestIds.add(requestId);
    clearPendingInteraction(request);
    return true;
  }

  function emitSyntheticErrorConversationState({
    sessionId = "",
    dialogProcessId = "",
    sourceEvent = "",
  } = {}) {
    if (typeof onConversationState !== "function") return;
    onConversationState({
      source: "stream",
      state: "error",
      sessionId: String(sessionId || "").trim(),
      dialogProcessId: normalizeTrimmedString(dialogProcessId),
      sourceEvent: String(sourceEvent || "").trim(),
      seq: 0,
      applied: true,
    });
  }

  function getInteractionPayloadWaitKey({ sessionId = "", dialogProcessId = "" } = {}) {
    return `${String(sessionId || "").trim()}::${normalizeTrimmedString(dialogProcessId)}`;
  }

  function clearMissingInteractionPayloadTimer({
    sessionId = "",
    dialogProcessId = "",
  } = {}) {
    const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
    const timer = missingInteractionPayloadTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    missingInteractionPayloadTimers.delete(key);
  }

  function hasPendingInteractionForDialog(dialogProcessId = "") {
    const pendingRequest =
      pendingInteractionRequest.value && typeof pendingInteractionRequest.value === "object"
        ? pendingInteractionRequest.value
        : null;
    if (!pendingRequest) return false;
    return isBlankCompatibleSameId(pendingRequest?.dialogProcessId, dialogProcessId);
  }

  function scheduleMissingInteractionPayloadFailure({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    if (hasPendingInteractionForDialog(dialogProcessId)) return;
    const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
    if (missingInteractionPayloadTimers.has(key)) return;
    const timer = setTimeout(() => {
      missingInteractionPayloadTimers.delete(key);
      if (hasPendingInteractionForDialog(dialogProcessId)) return;
      if (applyRunStateEvent) {
        applyRunStateEvent({
          type: SESSION_RUN_EVENT.LOCAL_FAILURE,
          state: "error",
          sessionId,
          dialogProcessId,
          source: "interaction_payload_missing",
        });
      } else {
        sending.value = false;
        if (canStop) canStop.value = false;
      }
      clearPendingInteraction();
      const missingInteractionError = translate("chat.interactionPayloadMissing");
      applyAssistantFailureState(targetAssistantMessage, missingInteractionError);
      emitSyntheticErrorConversationState({
        sessionId,
        dialogProcessId,
        sourceEvent: "interaction_payload_missing",
      });
      notify({ type: "error", message: missingInteractionError });
    }, 1200);
    missingInteractionPayloadTimers.set(key, timer);
  }

  function scheduleCacheExpiredSessionRefresh({
    sessionId = "",
    dialogProcessId = "",
    targetAssistantMessage = null,
  } = {}) {
    if (cacheExpiredRefreshTimer) clearTimeout(cacheExpiredRefreshTimer);
    cacheExpiredRefreshTimer = setTimeout(() => {
      cacheExpiredRefreshTimer = null;
      if (typeof refreshSessionsAsync !== "function") return;
      Promise.resolve(
        refreshSessionsAsync(String(activeSessionId.value || ""), {
          silent: true,
          preserveCurrentMessages: true,
        }),
      )
        .then((ok) => {
          if (ok !== false) return;
          if (applyRunStateEvent) {
            applyRunStateEvent({
              type: SESSION_RUN_EVENT.LOCAL_FAILURE,
              state: "error",
              sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
              dialogProcessId,
              source: "expired_refresh_failed",
            });
          } else {
            sending.value = false;
            if (canStop) canStop.value = false;
          }
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          applyAssistantFailureState(targetAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        })
        .catch(() => {
          if (applyRunStateEvent) {
            applyRunStateEvent({
              type: SESSION_RUN_EVENT.LOCAL_FAILURE,
              state: "error",
              sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
              dialogProcessId,
              source: "expired_refresh_failed",
            });
          } else {
            sending.value = false;
            if (canStop) canStop.value = false;
          }
          interactionSubmitting.value = false;
          clearPendingInteraction();
          const expiredErrorMessage = translate("chat.expiredRefreshFailed");
          applyAssistantFailureState(targetAssistantMessage, expiredErrorMessage);
          emitSyntheticErrorConversationState({
            sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
            dialogProcessId,
            sourceEvent: "expired_refresh_failed",
          });
          notify({ type: "error", message: expiredErrorMessage });
        });
    }, 1200);
  }
  function isStateForActiveSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return true;
    return (
      normalizedSessionId === String(activeSession.value?.id || "").trim() ||
      normalizedSessionId === String(activeSession.value?.backendSessionId || "").trim()
    );
  }

  function markUserMessageDialogProcessId({ targetAssistantMessage = null, dialogProcessId = "" } = {}) {
    const normalizedDialogProcessId = normalizeTrimmedString(dialogProcessId);
    const messages = Array.isArray(activeSession?.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!normalizedDialogProcessId || !messages.length) return false;
    const assistantIndex = targetAssistantMessage
      ? messages.findIndex((messageItem) => messageItem === targetAssistantMessage)
      : messages.length;
    const startIndex = assistantIndex >= 0 ? assistantIndex - 1 : messages.length - 1;
    for (let index = startIndex; index >= 0; index -= 1) {
      const messageItem = messages[index];
      if (normalizeTrimmedString(messageItem?.role) !== RoleEnum.USER) continue;
      const currentDialogProcessId = normalizeTrimmedString(
        messageItem?.dialogProcessId || messageItem?.dialogId,
      );
      if (currentDialogProcessId && currentDialogProcessId !== normalizedDialogProcessId) {
        return false;
      }
      messageItem.dialogProcessId = normalizedDialogProcessId;
      const rawMessages = Array.isArray(activeSession?.value?.rawMessages)
        ? activeSession.value.rawMessages
        : [];
      const rawUserMessage = rawMessages.find((rawMessage) => rawMessage === messageItem) ||
        rawMessages.find(
          (rawMessage) =>
            normalizeTrimmedString(rawMessage?.role) === RoleEnum.USER &&
            rawMessage?.ts !== undefined &&
            messageItem?.ts !== undefined &&
            rawMessage.ts === messageItem.ts,
        );
      if (rawUserMessage) rawUserMessage.dialogProcessId = normalizedDialogProcessId;
      return true;
    }
    return false;
  }

  function findTargetAssistantMessage({ botMessage = null, dialogProcessId = "" } = {}) {
    if (botMessage && String(botMessage?.role || "").trim() === RoleEnum.ASSISTANT) {
      return botMessage;
    }
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const normalizedDpId = normalizeTrimmedString(dialogProcessId);
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (normalizeTrimmedString(messageItem?.role) !== RoleEnum.ASSISTANT) continue;
      if (
        normalizedDpId &&
        normalizeTrimmedString(messageItem?.dialogProcessId) &&
        normalizeTrimmedString(messageItem?.dialogProcessId) !== normalizedDpId
      ) {
        continue;
      }
      return messageItem;
    }
    return null;
  }

  function applyConversationState(
    statePayload = {},
    {
      botMessage = null,
      fallbackDialogProcessId = "",
      fallbackClientTurnId = "",
      allowMessageClientTurnFallback = true,
    } = {},
  ) {
    const state = String(statePayload?.state || "").trim();
    if (!state) return;
    const sessionId = String(statePayload?.sessionId || "").trim();
    const createdAtMs = Number(statePayload?.createdAtMs || 0);
    const updatedAtMs = Number(statePayload?.updatedAtMs || statePayload?.timestamp || createdAtMs || 0);
    const createdAt = String(
      statePayload?.createdAt || (createdAtMs > 0 ? new Date(createdAtMs).toISOString() : ""),
    ).trim();
    const updatedAt = String(
      statePayload?.updatedAt || (updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : ""),
    ).trim();
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const botMessageInActiveSession = Boolean(
      botMessage &&
      String(botMessage?.role || "").trim() === RoleEnum.ASSISTANT &&
      messageList.includes(botMessage),
    );
    const forActiveSession = isStateForActiveSession(sessionId) || botMessageInActiveSession;
    if (typeof onConversationState === "function") {
      const clientTurnId = String(
        statePayload?.clientTurnId ||
          (allowMessageClientTurnFallback ? botMessage?.clientTurnId : "") ||
          (allowMessageClientTurnFallback ? fallbackClientTurnId : "") ||
          "",
      ).trim();
      onConversationState({
        source: "stream",
        state,
        sessionId,
        dialogProcessId: String(
          statePayload?.dialogProcessId || fallbackDialogProcessId || "",
        ).trim(),
        clientTurnId,
        sourceEvent: String(statePayload?.sourceEvent || "").trim(),
        seq: Number(statePayload?.seq || 0),
        createdAtMs,
        updatedAtMs,
        createdAt,
        updatedAt,
        applied: forActiveSession,
      });
    }
    if (!forActiveSession) return;
    const dialogProcessId = String(
      statePayload?.dialogProcessId || fallbackDialogProcessId || "",
    ).trim();
    const clientTurnId = String(
      statePayload?.clientTurnId ||
        (allowMessageClientTurnFallback ? botMessage?.clientTurnId : "") ||
        (allowMessageClientTurnFallback ? fallbackClientTurnId : "") ||
        "",
    ).trim();
    const targetAssistantMessage = findTargetAssistantMessage({
      botMessage,
      dialogProcessId,
    });
    if (dialogProcessId && targetAssistantMessage) {
      if (!String(targetAssistantMessage?.dialogProcessId || "").trim()) {
        targetAssistantMessage.dialogProcessId = dialogProcessId;
      }
      markUserMessageDialogProcessId({ targetAssistantMessage, dialogProcessId });
    }
    if (isInFlightConversationState(state)) {
      if (applyRunStateEvent) {
        applyRunStateEvent({
          type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
          state,
          sessionId,
          dialogProcessId,
          clientTurnId,
          source: "stream",
          sourceEvent: String(statePayload?.sourceEvent || "").trim(),
          seq: Number(statePayload?.seq || 0),
          createdAtMs,
          updatedAtMs,
          createdAt,
          updatedAt,
        });
      } else {
        sending.value = true;
        if (canStop) canStop.value = ["sending", "reconnecting", "interaction_pending"].includes(state);
      }
      if (
        state === "sending" &&
        String(statePayload?.sourceEvent || "").trim().toLowerCase() === "interaction_response" &&
        typeof clearPendingInteractionIfObsolete === "function"
      ) {
        const responseRequestId = String(
          statePayload?.requestId ||
            statePayload?.interactionRequestId ||
            statePayload?.pendingInteraction?.requestId ||
            "",
        ).trim();
        if (responseRequestId) {
          clearPendingInteractionIfObsolete({ requestId: responseRequestId });
        }
      }
      if (state === "interaction_pending") {
        interactionSubmitting.value = false;
        const pendingInteractionPayloads = normalizePendingInteractionPayloads(statePayload);
        if (pendingInteractionPayloads.length) {
          clearMissingInteractionPayloadTimer({ sessionId, dialogProcessId });
          for (const pendingInteractionPayload of pendingInteractionPayloads) {
            const normalizedPendingInteractionRequest = normalizeInteractionRequestPayload({
              ...pendingInteractionPayload,
              interactionType: String(
                pendingInteractionPayload?.interactionType || "",
              ).trim(),
            });
            if (!tryAutoResolveInteraction(normalizedPendingInteractionRequest)) {
              setPendingInteractionRequest(normalizedPendingInteractionRequest);
            }
          }
        } else {
          // Some backends emit `interaction_pending` without embedding
          // `pendingInteraction` in channel_state, while the actual
          // `interaction_request` event arrives separately.
          // If we already have a pending request for this turn, keep waiting
          // instead of marking the assistant turn as failed.
          const existingPendingRequest =
            pendingInteractionRequest.value &&
            typeof pendingInteractionRequest.value === "object"
              ? pendingInteractionRequest.value
              : null;
          if (existingPendingRequest) {
            if (isBlankCompatibleSameId(existingPendingRequest?.dialogProcessId, dialogProcessId)) {
              return;
            }
          }
          scheduleMissingInteractionPayloadFailure({
            sessionId,
            dialogProcessId,
            targetAssistantMessage,
          });
          return;
        }
      }
      if (targetAssistantMessage) {
        targetAssistantMessage.pending = true;
        if (state === "stopping") {
          targetAssistantMessage.statusLabel = translate("chat.stopping");
        } else if (state === "reconnecting") {
          targetAssistantMessage.statusLabel = translate("chat.reconnecting");
        } else if (state === "sending") {
          targetAssistantMessage.statusLabel = "";
        }
      }
      return;
    }
    if (!isTerminalConversationState(state)) return;
    clearRememberedStopRequests({ sessionId, dialogProcessId });
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        clientTurnId,
        source: "stream",
        sourceEvent: String(statePayload?.sourceEvent || "").trim(),
        seq: Number(statePayload?.seq || 0),
        createdAtMs,
        updatedAtMs,
        createdAt,
        updatedAt,
      });
    } else {
      sending.value = false;
      if (canStop) canStop.value = false;
    }
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    clearMissingInteractionPayloadTimer({ sessionId, dialogProcessId });
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
    if (state === "expired") {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    if (state === "no_conversation" || state === "expired") {
      clearPendingInteraction();
      return;
    }
    if (!targetAssistantMessage) return;
    targetAssistantMessage.pending = false;
    if (state === "completed") {
      targetAssistantMessage.statusLabel = translate("chat.generated");
      return;
    }
    if (state === "stopped" || state === "cancelled" || state === "canceled") {
      targetAssistantMessage.statusLabel = translate("chat.stopped");
      if (!String(targetAssistantMessage.content || "").trim()) {
        targetAssistantMessage.content = translate("chat.stoppedContent");
      }
      return;
    }
    if (state === "error") {
      targetAssistantMessage.statusLabel = translate("chat.failed");
    }
  }

  function applyConversationStateFromEvent(
    eventName = "",
    eventData = {},
    { botMessage = null, fallbackDialogProcessId = "", fallbackClientTurnId = "" } = {},
  ) {
    const normalizedEvent = String(eventName || "").trim();
    if (normalizedEvent !== StreamEventEnum.CHANNEL_STATE) return;
    applyConversationState(eventData, {
      botMessage,
      fallbackDialogProcessId,
      fallbackClientTurnId,
      allowMessageClientTurnFallback: Boolean(String(eventData?.dialogProcessId || "").trim()),
    });
  }

  function disposeConversationState() {
    if (cacheExpiredRefreshTimer) {
      clearTimeout(cacheExpiredRefreshTimer);
      cacheExpiredRefreshTimer = null;
    }
    for (const timer of missingInteractionPayloadTimers.values()) {
      clearTimeout(timer);
    }
    missingInteractionPayloadTimers.clear();
    connectorConnectedAckedRequestIds.clear();
  }

  return {
    applyConversationState,
    applyConversationStateFromEvent,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
    findTargetAssistantMessage,
    tryAutoResolveInteraction,
  };
}
