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
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
} from "../sessionRunStateMachine";
import { normalizeTurnMeta } from "../../infra/messageIdentity";
import {
  getThinkingFinishedAt,
  getThinkingStartedAt,
  normalizeTimePair,
  nowIso,
  nowMs,
  parseTimeMs,
  setThinkingFinishedAt,
  setThinkingStartedAt,
} from "../../infra/timeFields";
import {
  bindThinkingDialogProcess,
  rememberThinkingFinished,
  rememberThinkingStarted,
} from "../thinkingTimingRegistry";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger";

function parseThinkingTimingMs(value) {
  return parseTimeMs(value);
}

function applyMissingThinkingStartedAt(targetAssistantMessage = null, nextStartedAt = "") {
  if (!targetAssistantMessage) return;
  const currentStartedAtMs = parseThinkingTimingMs(getThinkingStartedAt(targetAssistantMessage));
  if (currentStartedAtMs > 0) return;
  const nextStartedAtMs = parseThinkingTimingMs(nextStartedAt);
  if (nextStartedAtMs <= 0) return;
  setThinkingStartedAt(targetAssistantMessage, nextStartedAtMs);
}

function resolveThinkingStartedAtMs(targetAssistantMessage = null, fallbackMs = 0) {
  return (
    Number(fallbackMs || 0) ||
    parseTimeMs(getThinkingStartedAt(targetAssistantMessage)) ||
    parseTimeMs(targetAssistantMessage?.channelState?.createdAtMs) ||
    nowMs()
  );
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
    state: BackendChannelState.ERROR,
    sessionId: _trimStr(sessionId),
    dialogProcessId: _trimStr(dialogProcessId),
    sourceEvent: _trimStr(sourceEvent),
    seq: 0,
    applied: true,
  });
}

function normalizeReconnectChannelTiming(stateData = {}) {
  return normalizeTimePair(stateData);
}


function applyReconnectChannelTimingToMessage({
  targetAssistantMessage = null,
  state = "",
  sessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  stateData = {},
  terminal = false,
} = {}) {
  if (!targetAssistantMessage) return;
  if (sessionId) {
    targetAssistantMessage.sessionId = targetAssistantMessage.sessionId || sessionId;
    targetAssistantMessage.session_id = targetAssistantMessage.session_id || sessionId;
  }
  if (dialogProcessId) {
    bindThinkingDialogProcess({ sessionId, dialogProcessId, turnScopeId });
  }
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
    turnScopeId,
    sourceEvent: _trimStr(stateData?.sourceEvent),
    seq: Number(stateData?.seq || 0),
    createdAtMs: timing.createdAtMs || Number(previousChannelState?.createdAtMs || 0),
    updatedAtMs: timing.updatedAtMs,
    createdAt: timing.createdAt || _trimStr(previousChannelState?.createdAt || targetAssistantMessage?.thinkingStartedAt),
    updatedAt: timing.updatedAt,
  };
  targetAssistantMessage.channelState = channelState;
  applyMissingThinkingStartedAt(targetAssistantMessage, channelState.createdAt || channelState.createdAtMs);
  if (terminal) {
    setThinkingFinishedAt(
      targetAssistantMessage,
      getThinkingFinishedAt(targetAssistantMessage) || channelState.updatedAt || channelState.createdAt || nowIso(),
    );
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
  timeoutMs = TIME_THRESHOLDS.client.missingInteractionPayloadTimeoutMs,
} = {}) {
  if (hasPendingInteractionForDialog(pendingInteractionRequest, dialogProcessId)) return;
  const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
  if (missingInteractionPayloadTimers.has(key)) return;
  const timer = setTimeout(() => {
    missingInteractionPayloadTimers.delete(key);
    if (hasPendingInteractionForDialog(pendingInteractionRequest, dialogProcessId)) return;
    if (typeof applyRunStateEvent === "function") {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_FAILURE,
        state: BackendChannelState.ERROR,
        sessionId,
        dialogProcessId,
        source: "interaction_payload_missing",
      });
    } else {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
      sending.value = false;
      if (canStop) canStop.value = false;
    }
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

export async function applyReconnectChannelState({
  stateData = {},
  onConversationState,
  isCurrentActiveSession,
  findAssistantMessageByTurnScopeId,
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
  finalizeReplayCompletedSessionDetail,
  clearPendingInteraction,
  translate,
} = {}) {
  const turnMeta = normalizeTurnMeta(stateData);
  const sessionId = _trimStr(stateData?.sessionId);
  const forActiveSession = !sessionId || isCurrentActiveSession(sessionId);
  const timing = normalizeReconnectChannelTiming(stateData);
  if (typeof onConversationState === "function") {
    onConversationState({
      source: "reconnect",
      state: _trimStr(stateData?.state),
      sessionId,
      dialogProcessId: _trimStr(stateData?.dialogProcessId),
      turnScopeId: turnMeta.turnScopeId,
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
  const turnScopeId = turnMeta.turnScopeId;
  const targetAssistantMessage =
    (turnScopeId && typeof findAssistantMessageByTurnScopeId === "function"
      ? findAssistantMessageByTurnScopeId(turnScopeId)
      : null) ||
    (!turnScopeId && dialogProcessId && typeof findAssistantMessageByDialogProcessId === "function"
      ? findAssistantMessageByDialogProcessId(dialogProcessId)
      : null) ||
    (!turnScopeId && !dialogProcessId && typeof findFallbackAssistantMessage === "function"
      ? findFallbackAssistantMessage()
      : null);
  logResendDebug("channelStateReplay.target", {
    state,
    sessionId,
    dialogProcessId,
    turnScopeId,
    sourceEvent: _trimStr(stateData?.sourceEvent),
    targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
  });
  if (isInFlightConversationState(state)) {
    rememberThinkingStarted({
      sessionId,
      dialogProcessId,
      turnScopeId,
      startedAtMs: resolveThinkingStartedAtMs(targetAssistantMessage, timing.createdAtMs),
      updatedAtMs: timing.updatedAtMs,
    });
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        turnScopeId,
          source: "reconnect",
        sourceEvent: _trimStr(stateData?.sourceEvent),
        seq: Number(stateData?.seq || 0),
        createdAtMs: timing.createdAtMs,
        updatedAtMs: timing.updatedAtMs,
        createdAt: timing.createdAt,
        updatedAt: timing.updatedAt,
      });
    } else {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
      sending.value = true;
      if (canStop) {
        canStop.value = state === BackendChannelState.SENDING || state === BackendChannelState.RECONNECTING;
      }
    }
    if (
      state === BackendChannelState.SENDING &&
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
    if (state === BackendChannelState.INTERACTION_PENDING) {
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
      const beforeTerminalApply = summarizeDebugMessage(targetAssistantMessage);
      applyReconnectChannelTimingToMessage({
        targetAssistantMessage,
        state,
        sessionId,
        dialogProcessId,
        turnScopeId,
        stateData,
      });
      targetAssistantMessage.pending = true;
      if (state === BackendChannelState.STOPPING) {
        targetAssistantMessage.statusLabel = translate("chat.stopping");
      } else if (state === BackendChannelState.RECONNECTING) {
        targetAssistantMessage.statusLabel = translate("chat.reconnecting");
      } else if (state === BackendChannelState.SENDING) {
        targetAssistantMessage.statusLabel = "";
      }
    }
    return;
  }
  if (isTerminalConversationState(state)) {
    if (dialogProcessId) terminalDialogProcessIdSet.add(dialogProcessId);
    if (_trimStr(stateData?.sourceEvent) !== "done") {
      chatWebSocketClient.clearStopRequested();
    }
    clearRememberedStopRequests({ sessionId, dialogProcessId, turnScopeId });
    rememberThinkingFinished({
      sessionId,
      dialogProcessId,
      turnScopeId,
      finishedAtMs: timing.updatedAtMs || nowMs(),
      finishedAt: timing.updatedAt,
    });
    interactionSubmitting.value = false;
    if (state === BackendChannelState.EXPIRED) {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        turnScopeId,
          source: "reconnect",
        sourceEvent: _trimStr(stateData?.sourceEvent),
        seq: Number(stateData?.seq || 0),
        createdAtMs: timing.createdAtMs,
        updatedAtMs: timing.updatedAtMs,
        createdAt: timing.createdAt,
        updatedAt: timing.updatedAt,
      });
    } else {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
      sending.value = false;
      if (canStop) canStop.value = false;
    }
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    clearMissingInteractionPayloadTimer(missingInteractionPayloadTimers, { sessionId, dialogProcessId });
    if (state === BackendChannelState.NO_CONVERSATION || state === BackendChannelState.EXPIRED) {
      clearPendingInteraction();
      interactionSubmitting.value = false;
      if (targetAssistantMessage) targetAssistantMessage.pending = false;
      return;
    }
    let shouldFinalizeCompletedReplay = state === BackendChannelState.COMPLETED;
    if (targetAssistantMessage) {
      const beforeTerminalApply = summarizeDebugMessage(targetAssistantMessage);
      applyReconnectChannelTimingToMessage({
        targetAssistantMessage,
        state,
        sessionId,
        dialogProcessId,
        turnScopeId,
        stateData,
        terminal: true,
      });
      if (state === BackendChannelState.COMPLETED) {
        logResendDebug("channelStateReplay.backendCompleted.apply", {
          state,
          sessionId,
          dialogProcessId,
          turnScopeId,
          before: beforeTerminalApply,
          after: summarizeDebugMessage(targetAssistantMessage),
        });
        targetAssistantMessage.pending = false;
        targetAssistantMessage.statusLabel = translate("chat.generated");
        shouldFinalizeCompletedReplay = true;
      } else {
        targetAssistantMessage.pending = false;
        if (state === BackendChannelState.STOPPED) {
          targetAssistantMessage.statusLabel = translate("chat.stopped");
        } else if (state === FrontendRunState.CANCELLED) {
          targetAssistantMessage.statusLabel = translate("chat.stopped");
        } else if (state === BackendChannelState.ERROR) {
          targetAssistantMessage.statusLabel = translate("chat.failed");
        }
        logResendDebug("channelStateReplay.terminal.apply", {
          state,
          sessionId,
          dialogProcessId,
          turnScopeId,
          before: beforeTerminalApply,
          after: summarizeDebugMessage(targetAssistantMessage),
        });
      }
    }
    if (shouldFinalizeCompletedReplay) {
      await finalizeReplayCompletedSessionDetail?.({
        sessionId,
        dialogProcessId,
        turnScopeId,
        targetAssistantMessage,
        stateData,
      });
    }
  }
}
