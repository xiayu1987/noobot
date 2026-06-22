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
import {
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
} from "../sessionRunStateMachine";
import {
  bindThinkingDialogProcess,
  rememberThinkingFinished,
  rememberThinkingStarted,
} from "../thinkingTimingRegistry";

function parseThinkingTimingMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber > 1e11 ? asNumber : asNumber * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function applyEarliestThinkingStartedAt(targetAssistantMessage = null, nextStartedAt = "") {
  if (!targetAssistantMessage) return;
  const nextStartedAtMs = parseThinkingTimingMs(nextStartedAt);
  if (nextStartedAtMs <= 0) return;
  const currentStartedAtMs = parseThinkingTimingMs(
    targetAssistantMessage?.thinkingStartedAt || targetAssistantMessage?.thinking_started_at,
  );
  if (currentStartedAtMs > 0 && currentStartedAtMs <= nextStartedAtMs) return;
  const normalizedStartedAt = new Date(nextStartedAtMs).toISOString();
  targetAssistantMessage.thinkingStartedAt = normalizedStartedAt;
  targetAssistantMessage.thinking_started_at = normalizedStartedAt;
}

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

function normalizeReconnectChannelTiming(stateData = {}) {
  const createdAtMs = Number(stateData?.createdAtMs || 0);
  const updatedAtMs = Number(stateData?.updatedAtMs || stateData?.timestamp || createdAtMs || 0);
  const createdAt = _trimStr(
    stateData?.createdAt || (createdAtMs > 0 ? new Date(createdAtMs).toISOString() : ""),
  );
  const updatedAt = _trimStr(
    stateData?.updatedAt || (updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : ""),
  );
  return { createdAtMs, updatedAtMs, createdAt, updatedAt };
}

function applyReconnectChannelTimingToMessage({
  targetAssistantMessage = null,
  state = "",
  sessionId = "",
  dialogProcessId = "",
  clientTurnId = "",
  stateData = {},
  terminal = false,
} = {}) {
  if (!targetAssistantMessage) return;
  if (sessionId) {
    targetAssistantMessage.sessionId = targetAssistantMessage.sessionId || sessionId;
    targetAssistantMessage.session_id = targetAssistantMessage.session_id || sessionId;
  }
  if (dialogProcessId) bindThinkingDialogProcess({ sessionId, dialogProcessId, clientTurnId });
  const timing = normalizeReconnectChannelTiming(stateData);
  const previousChannelState =
    targetAssistantMessage.channelState &&
    typeof targetAssistantMessage.channelState === "object" &&
    !Array.isArray(targetAssistantMessage.channelState)
      ? targetAssistantMessage.channelState
      : {};
  const channelState = {
    ...previousChannelState,
    state,
    sessionId,
    dialogProcessId,
    clientTurnId,
    sourceEvent: _trimStr(stateData?.sourceEvent),
    seq: Number(stateData?.seq || 0),
    createdAtMs: timing.createdAtMs || Number(previousChannelState?.createdAtMs || 0),
    updatedAtMs: timing.updatedAtMs,
    createdAt: timing.createdAt || _trimStr(previousChannelState?.createdAt || targetAssistantMessage?.thinkingStartedAt),
    updatedAt: timing.updatedAt,
  };
  targetAssistantMessage.channelState = channelState;
  applyEarliestThinkingStartedAt(targetAssistantMessage, channelState.createdAt || channelState.createdAtMs);
  if (terminal) {
    const finishedAt = channelState.updatedAt || channelState.createdAt || new Date().toISOString();
    targetAssistantMessage.thinkingFinishedAt = targetAssistantMessage.thinkingFinishedAt || finishedAt;
    targetAssistantMessage.thinking_finished_at = targetAssistantMessage.thinking_finished_at || finishedAt;
  }
}

export function scheduleMissingInteractionPayloadFailure({
  pendingInteractionRequest,
  missingInteractionPayloadTimers,
  sessionId = "",
  dialogProcessId = "",
  targetAssistantMessage = null,
  sending,
  canStop,
  applyRunStateEvent,
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
    if (canStop) canStop.value = false;
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
  findFallbackAssistantMessage,
  sending,
  canStop,
  applyRunStateEvent,
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
  const timing = normalizeReconnectChannelTiming(stateData);
  if (typeof onConversationState === "function") {
    onConversationState({
      source: "reconnect",
      state: _trimStr(stateData?.state),
      sessionId,
      dialogProcessId: _trimStr(stateData?.dialogProcessId),
      clientTurnId: _trimStr(stateData?.clientTurnId),
      sourceEvent: _trimStr(stateData?.sourceEvent),
      seq: Number(stateData?.seq || 0),
      createdAtMs: timing.createdAtMs,
      updatedAtMs: timing.updatedAtMs,
      createdAt: timing.createdAt,
      updatedAt: timing.updatedAt,
      applied: forActiveSession,
    });
  }
  if (!forActiveSession) return;
  const state = _trimStr(stateData?.state);
  const dialogProcessId = _trimStr(stateData?.dialogProcessId);
  const clientTurnId = _trimStr(stateData?.clientTurnId);
  const targetAssistantMessage =
    findAssistantMessageByDialogProcessId(dialogProcessId) ||
    (typeof findFallbackAssistantMessage === "function"
      ? findFallbackAssistantMessage()
      : null);
  if (isInFlightConversationState(state)) {
    rememberThinkingStarted({
      sessionId,
      dialogProcessId,
      clientTurnId,
      startedAtMs: timing.createdAtMs || targetAssistantMessage?.thinkingStartedAt || targetAssistantMessage?.channelState?.createdAtMs || Date.now(),
      updatedAtMs: timing.updatedAtMs,
    });
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        clientTurnId,
        source: "reconnect",
        sourceEvent: _trimStr(stateData?.sourceEvent),
        seq: Number(stateData?.seq || 0),
        createdAtMs: timing.createdAtMs,
        updatedAtMs: timing.updatedAtMs,
        createdAt: timing.createdAt,
        updatedAt: timing.updatedAt,
      });
    } else {
      sending.value = true;
      if (canStop) canStop.value = state === "sending" || state === "reconnecting";
    }
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
      applyReconnectChannelTimingToMessage({
        targetAssistantMessage,
        state,
        sessionId,
        dialogProcessId,
        clientTurnId,
        stateData,
      });
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
    clearRememberedStopRequests({ sessionId, dialogProcessId });
    rememberThinkingFinished({
      sessionId,
      dialogProcessId,
      clientTurnId,
      finishedAtMs: timing.updatedAtMs || Date.now(),
      finishedAt: timing.updatedAt,
    });
    interactionSubmitting.value = false;
    if (state === "expired") {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        clientTurnId,
        source: "reconnect",
        sourceEvent: _trimStr(stateData?.sourceEvent),
        seq: Number(stateData?.seq || 0),
        createdAtMs: timing.createdAtMs,
        updatedAtMs: timing.updatedAtMs,
        createdAt: timing.createdAt,
        updatedAt: timing.updatedAt,
      });
    } else {
      sending.value = false;
      if (canStop) canStop.value = false;
    }
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    clearMissingInteractionPayloadTimer(missingInteractionPayloadTimers, { sessionId, dialogProcessId });
    if (state === "no_conversation" || state === "expired") {
      clearPendingInteraction();
      interactionSubmitting.value = false;
      if (targetAssistantMessage) targetAssistantMessage.pending = false;
      return;
    }
    if (targetAssistantMessage) {
      applyReconnectChannelTimingToMessage({
        targetAssistantMessage,
        state,
        sessionId,
        dialogProcessId,
        clientTurnId,
        stateData,
        terminal: true,
      });
      targetAssistantMessage.pending = false;
      if (state === "completed") {
        targetAssistantMessage.statusLabel = translate("chat.generated");
      } else if (state === "stopped") {
        targetAssistantMessage.statusLabel = translate("chat.stopped");
      } else if (state === "cancelled" || state === "canceled") {
        targetAssistantMessage.statusLabel = translate("chat.stopped");
      } else if (state === "error") {
        targetAssistantMessage.statusLabel = translate("chat.failed");
      }
    }
  }
}
