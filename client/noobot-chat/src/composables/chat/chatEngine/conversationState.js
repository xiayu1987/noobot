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

export function createChatEngineConversationState({
  activeSession,
  activeSessionId,
  sending,
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
      sending.value = false;
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
          sending.value = false;
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
          sending.value = false;
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
    { botMessage = null, fallbackDialogProcessId = "" } = {},
  ) {
    const state = String(statePayload?.state || "").trim();
    if (!state) return;
    const sessionId = String(statePayload?.sessionId || "").trim();
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
      onConversationState({
        source: "stream",
        state,
        sessionId,
        dialogProcessId: String(
          statePayload?.dialogProcessId || fallbackDialogProcessId || "",
        ).trim(),
        sourceEvent: String(statePayload?.sourceEvent || "").trim(),
        seq: Number(statePayload?.seq || 0),
        applied: forActiveSession,
      });
    }
    if (!forActiveSession) return;
    const dialogProcessId = String(
      statePayload?.dialogProcessId || fallbackDialogProcessId || "",
    ).trim();
    const targetAssistantMessage = findTargetAssistantMessage({
      botMessage,
      dialogProcessId,
    });
    if (
      dialogProcessId &&
      targetAssistantMessage &&
      !String(targetAssistantMessage?.dialogProcessId || "").trim()
    ) {
      targetAssistantMessage.dialogProcessId = dialogProcessId;
    }
    if (isInFlightConversationState(state)) {
      sending.value = true;
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
    sending.value = false;
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
    if (state === "stopped") {
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
    { botMessage = null, fallbackDialogProcessId = "" } = {},
  ) {
    const normalizedEvent = String(eventName || "").trim();
    if (normalizedEvent !== StreamEventEnum.CHANNEL_STATE) return;
    applyConversationState(eventData, { botMessage, fallbackDialogProcessId });
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
