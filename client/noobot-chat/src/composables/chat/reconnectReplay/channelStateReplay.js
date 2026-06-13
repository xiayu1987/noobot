/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  clearMissingInteractionPayloadTimer,
  getInteractionPayloadWaitKey,
  hasPendingInteractionForDialog,
  normalizePendingInteractionPayloads,
} from "./interactionReplay";
import {
  isInFlightConversationState,
  isTerminalConversationState,
} from "./conversationState";
import { _trimStr } from "./utils";

export function emitSyntheticReconnectErrorConversationState({
  onConversationState,
  sessionId = "",
  dialogProcessId = "",
  sourceEvent = "",
} = {}) {
  if (typeof onConversationState !== "function") return;
  onConversationState({
    source: "reconnect",
    state: "error",
    sessionId: _trimStr(sessionId),
    dialogProcessId: _trimStr(dialogProcessId),
    sourceEvent: _trimStr(sourceEvent),
    seq: 0,
    applied: true,
  });
}

export function scheduleMissingInteractionPayloadFailure({
  pendingInteractionRequest,
  missingInteractionPayloadTimers,
  sessionId = "",
  dialogProcessId = "",
  targetAssistantMessage = null,
  sending,
  interactionSubmitting,
  clearPendingInteraction,
  translate,
  findFallbackAssistantMessage,
  applyAssistantFailureState,
  emitSyntheticErrorConversationState,
  notify = () => {},
  timeoutMs = 1200,
} = {}) {
  if (hasPendingInteractionForDialog(pendingInteractionRequest, dialogProcessId)) return;
  const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
  if (missingInteractionPayloadTimers.has(key)) return;
  const timer = setTimeout(() => {
    missingInteractionPayloadTimers.delete(key);
    if (hasPendingInteractionForDialog(pendingInteractionRequest, dialogProcessId)) return;
    sending.value = false;
    interactionSubmitting.value = false;
    clearPendingInteraction();
    const missingInteractionError = translate("chat.interactionPayloadMissing");
    const fallbackAssistantMessage =
      targetAssistantMessage ||
      (typeof findFallbackAssistantMessage === "function" ? findFallbackAssistantMessage() : null);
    applyAssistantFailureState(fallbackAssistantMessage, missingInteractionError);
    emitSyntheticErrorConversationState({
      sessionId,
      dialogProcessId,
      sourceEvent: "interaction_payload_missing",
    });
    notify({ type: "error", message: missingInteractionError });
  }, timeoutMs);
  missingInteractionPayloadTimers.set(key, timer);
}

export function applyReconnectChannelState({
  stateData = {},
  onConversationState,
  isCurrentActiveSession,
  findAssistantMessageByDialogProcessId,
  sending,
  interactionSubmitting,
  clearPendingInteractionIfObsolete,
  pendingInteractionRequest,
  normalizeInteractionRequestPayload,
  tryAutoResolveInteraction,
  isInteractionRequestHandled,
  setPendingInteractionRequest,
  scheduleMissingInteractionPayloadFailure,
  missingInteractionPayloadTimers,
  terminalDialogProcessIdSet,
  chatWebSocketClient,
  scheduleCacheExpiredSessionRefresh,
  clearPendingInteraction,
  translate,
} = {}) {
  const sessionId = _trimStr(stateData?.sessionId);
  const forActiveSession = !sessionId || isCurrentActiveSession(sessionId);
  if (typeof onConversationState === "function") {
    onConversationState({
      source: "reconnect",
      state: _trimStr(stateData?.state),
      sessionId,
      dialogProcessId: _trimStr(stateData?.dialogProcessId),
      sourceEvent: _trimStr(stateData?.sourceEvent),
      seq: Number(stateData?.seq || 0),
      applied: forActiveSession,
    });
  }
  if (!forActiveSession) return;
  const state = _trimStr(stateData?.state);
  const dialogProcessId = _trimStr(stateData?.dialogProcessId);
  const targetAssistantMessage = findAssistantMessageByDialogProcessId(dialogProcessId);
  if (isInFlightConversationState(state)) {
    sending.value = true;
    if (
      state === "sending" &&
      _trimStr(stateData?.sourceEvent).toLowerCase() === "interaction_response" &&
      typeof clearPendingInteractionIfObsolete === "function"
    ) {
      const responseRequestId = String(
        stateData?.requestId ||
          stateData?.interactionRequestId ||
          stateData?.pendingInteraction?.requestId ||
          "",
      ).trim();
      if (responseRequestId) {
        clearPendingInteractionIfObsolete({ requestId: responseRequestId });
      }
    }
    if (state === "interaction_pending") {
      interactionSubmitting.value = false;
      const pendingInteractionPayloads = normalizePendingInteractionPayloads(stateData);
      if (pendingInteractionPayloads.length) {
        clearMissingInteractionPayloadTimer(missingInteractionPayloadTimers, { sessionId, dialogProcessId });
        for (const pendingInteractionPayload of pendingInteractionPayloads) {
          const interactionRequest = normalizeInteractionRequestPayload({
            ...pendingInteractionPayload,
            interactionType: _trimStr(pendingInteractionPayload?.interactionType),
          });
          if (tryAutoResolveInteraction(interactionRequest)) continue;
          if (!isInteractionRequestHandled(interactionRequest)) {
            setPendingInteractionRequest(interactionRequest);
          }
        }
      } else {
        const existingPendingRequest =
          pendingInteractionRequest.value && typeof pendingInteractionRequest.value === "object"
            ? pendingInteractionRequest.value
            : null;
        if (existingPendingRequest) {
          const existingDialogProcessId = String(
            existingPendingRequest?.dialogProcessId || "",
          ).trim();
          if (!dialogProcessId || !existingDialogProcessId || existingDialogProcessId === dialogProcessId) {
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
  if (isTerminalConversationState(state)) {
    if (dialogProcessId) terminalDialogProcessIdSet.add(dialogProcessId);
    chatWebSocketClient.clearStopRequested();
    interactionSubmitting.value = false;
    if (state === "expired") {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    sending.value = false;
    if (["completed", "stopped", "error", "no_conversation", "expired"].includes(state)) {
      if (typeof clearPendingInteractionIfObsolete === "function") {
        clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
      }
    }
    clearMissingInteractionPayloadTimer(missingInteractionPayloadTimers, { sessionId, dialogProcessId });
    if (state === "no_conversation" || state === "expired") {
      clearPendingInteraction();
      interactionSubmitting.value = false;
      if (targetAssistantMessage) targetAssistantMessage.pending = false;
      return;
    }
    if (targetAssistantMessage) {
      targetAssistantMessage.pending = false;
      if (state === "completed") {
        targetAssistantMessage.statusLabel = translate("chat.generated");
      } else if (state === "stopped") {
        targetAssistantMessage.statusLabel = translate("chat.stopped");
      } else if (state === "error") {
        targetAssistantMessage.statusLabel = translate("chat.failed");
      }
    }
  }
}
