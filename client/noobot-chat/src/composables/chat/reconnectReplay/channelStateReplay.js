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
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
} from "../sessionRunStateMachine";
import { selectTurnMessageRuntime } from "../sessionRunStateMachine/turnRuntimeRegistry";
import { normalizeTurnMeta } from "../../infra/messageIdentity";
import { normalizeTimePair } from "../../infra/timeFields";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger";
import { createTurnObservation } from "../chatEngine/turnObservation";
import { createTurnKey } from "../chatEngine/turnIdentity";


export function emitSyntheticReconnectErrorConversationState({
  onConversationState,
  sessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  sourceEvent = "",
} = {}) {
  if (typeof onConversationState !== "function") return;
  onConversationState({
    source: "reconnect",
    state: BackendChannelState.ERROR,
    sessionId: _trimStr(sessionId),
    dialogProcessId: _trimStr(dialogProcessId),
    turnScopeId: _trimStr(turnScopeId),
    sourceEvent: _trimStr(sourceEvent),
    seq: 0,
    applied: true,
  });
}

function normalizeReconnectChannelTiming(stateData = {}) {
  return normalizeTimePair(stateData);
}


export function scheduleMissingInteractionPayloadFailure({
  pendingInteractionRequest,
  missingInteractionPayloadTimers,
  sessionId = "",
  dialogProcessId = "",
  turnScopeId = "",
  targetAssistantMessage = null,
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
    interactionSubmitting.value = false;
    clearPendingInteraction();
    const missingInteractionError = translate("chat.interactionPayloadMissing");
    emitSyntheticErrorConversationState({
      sessionId,
      dialogProcessId,
      turnScopeId,
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
  turnRuntimeRegistry,
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
      authoritativeSnapshot: stateData?.authoritativeSnapshot === true,
      applied: forActiveSession,
    });
  }
  if (!forActiveSession) {
    return {
      sessionId,
      turnScopeId: turnMeta.turnScopeId,
      turnKey: sessionId && turnMeta.turnScopeId ? `${sessionId}:${turnMeta.turnScopeId}` : "",
      exactTurnMatched: false,
      pendingBefore: false,
      applied: false,
      reason: "inactive_session",
      transitions: [],
    };
  }
  const state = _trimStr(stateData?.state);
  const dialogProcessId = _trimStr(stateData?.dialogProcessId);
  const turnScopeId = turnMeta.turnScopeId;
  const targetAssistantMessage =
    (turnScopeId && typeof findAssistantMessageByTurnScopeId === "function"
      ? findAssistantMessageByTurnScopeId(turnScopeId)
      : null);
  const transitionResults = [];
  const applyObservedRunStateEvent = (event, phase) => {
    const result = applyRunStateEvent?.(event);
    transitionResults.push({ phase, ...(result || { applied: false, reason: "runtime_dispatch_unavailable" }) });
    return result;
  };
  const replayObservation = () => {
    const lastTransition = transitionResults.at(-1) || null;
    const transitionObservation = lastTransition?.observation || lastTransition || {};
    return createTurnObservation({
    requestedSessionId: sessionId,
    canonicalSessionId: transitionObservation.canonicalSessionId || sessionId,
    turnKey: createTurnKey({ sessionId, turnScopeId }),
    eventId: _trimStr(stateData?.eventId),
    sequence: Number(stateData?.seq || stateData?.sequence || 0),
    source: "reconnect_channel_state",
    authority: stateData?.authoritativeSnapshot === true ? "authoritative_current_run" : "none",
    exactTurnMatched: Boolean(targetAssistantMessage),
    pendingBefore: targetAssistantMessage?.pending === true,
    applied: transitionResults.some((transition) => transition?.applied === true),
    reason: transitionResults.find((transition) => transition?.applied === false)?.reason ||
      (transitionResults.length ? "applied" :
        (state === BackendChannelState.COMPLETED && stateData?.authoritativeSnapshot !== true
          ? "lifecycle_authority_missing"
          : "no_runtime_transition")),
    aliasPromoted: transitionResults.some((transition) => transition?.aliasPromoted === true),
    finalState: transitionObservation.finalState || transitionObservation.state || state,
    messageEffect: transitionObservation.messageEffect || "none",
    transitions: transitionResults,
    });
  };
  logResendDebug("channelStateReplay.target", {
    state,
    sessionId,
    dialogProcessId,
    turnScopeId,
    sourceEvent: _trimStr(stateData?.sourceEvent),
    targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
  });
  if (isInFlightConversationState(state)) {
    const existingTurnRuntime = selectTurnMessageRuntime(
      turnRuntimeRegistry?.value || turnRuntimeRegistry,
      { sessionId, turnScopeId },
    );
    if (
      !existingTurnRuntime?.state &&
      sessionId &&
      turnScopeId &&
      [
        BackendChannelState.SENDING,
        BackendChannelState.RECONNECTING,
        BackendChannelState.INTERACTION_PENDING,
      ].includes(state)
    ) {
      applyObservedRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
        action: "send",
        sessionId,
        dialogProcessId,
        turnScopeId,
        source: "reconnect_hydration",
        sourceEvent: "channel_state_bootstrap",
        authoritativeSnapshot: true,
      }, "inflight_bootstrap_started");
    }
    applyObservedRunStateEvent({
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
        authoritativeSnapshot: stateData?.authoritativeSnapshot === true,
    }, "inflight_state");
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
            return replayObservation();
          }
        }
        scheduleMissingInteractionPayloadFailure({
          sessionId,
          dialogProcessId,
          turnScopeId,
          targetAssistantMessage,
        });
        return replayObservation();
      }
    }
    return replayObservation();
  }
  if (isTerminalConversationState(state)) {
    return replayObservation();
  }
  return replayObservation();
}
