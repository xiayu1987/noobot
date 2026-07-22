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
    applyRunStateEvent?.({
        type: SESSION_RUN_EVENT.LOCAL_FAILURE,
        state: BackendChannelState.ERROR,
        sessionId,
        dialogProcessId,
        turnScopeId,
        source: "interaction_payload_missing",
    });
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
  finalizeReplayCompletedSessionDetail,
  finalizeReplayStoppedSessionDetail,
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
    // A standalone reconnect channel_state can be the first fact observed
    // after a page reload. Rebuild the required action-request phase before
    // applying the backend processing fact; this is state hydration only and
    // must not issue another network request. Existing turns reject this
    // bootstrap event harmlessly and continue with the backend event below.
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
    // Message runtime state is projected exclusively by
    // turnRuntimeRegistry -> messageRuntimePatch after applyRunStateEvent.
    // Reconnect replay must not maintain a second mutable runtime mirror.
    return replayObservation();
  }
  if (isTerminalConversationState(state)) {
    const hasLifecycleAuthority = stateData?.authoritativeSnapshot === true;
    if (dialogProcessId) terminalDialogProcessIdSet.add(dialogProcessId);
    if (_trimStr(stateData?.sourceEvent) !== "done") {
      chatWebSocketClient.clearStopRequested();
    }
    clearRememberedStopRequests({ sessionId, dialogProcessId, turnScopeId });
    interactionSubmitting.value = false;
    if (state === BackendChannelState.EXPIRED) {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    // A terminal channel fact can be the first runtime fact observed after a
    // reload.  The Turn reducer deliberately rejects a terminal transition
    // without a preceding action/processing phase.  Reconstruct that phase
    // only when an exact Turn-scoped pending assistant proves ownership. Do
    // not bootstrap from dialogProcessId: an execution chain may span a
    // stopped Turn and its continuation.
    if (
      sessionId &&
      turnScopeId &&
      targetAssistantMessage?.pending === true &&
      hasLifecycleAuthority
    ) {
      applyObservedRunStateEvent({
        type: SESSION_RUN_EVENT.LOCAL_SEND_REQUEST_STARTED,
        action: "send",
        sessionId,
        dialogProcessId,
        turnScopeId,
        source: "reconnect_terminal_hydration",
        sourceEvent: "terminal_turn_bootstrap",
        authoritativeSnapshot: true,
      }, "terminal_bootstrap_started");
      applyObservedRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state: BackendChannelState.SENDING,
        sessionId,
        dialogProcessId,
        turnScopeId,
        source: "reconnect_terminal_hydration",
        sourceEvent: "terminal_processing_bootstrap",
        authoritativeSnapshot: true,
      }, "terminal_bootstrap_sending");
    }
    if (state !== BackendChannelState.COMPLETED || hasLifecycleAuthority) applyObservedRunStateEvent({
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
        // Identity routes the fact; it does not grant lifecycle authority.
        // Only currentRun hydration may create a terminal Turn from scratch.
        // An exact pending assistant is handled by the explicit bootstrap
        // above, so standalone DONE snapshots remain content-only.
        authoritativeSnapshot: stateData?.authoritativeSnapshot === true,
    }, "terminal_state");
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    clearMissingInteractionPayloadTimer(missingInteractionPayloadTimers, { sessionId, dialogProcessId });
    if (state === BackendChannelState.NO_CONVERSATION || state === BackendChannelState.EXPIRED) {
      clearPendingInteraction();
      interactionSubmitting.value = false;
      return replayObservation();
    }
    // Durable completion hydration is authorized only by the canonical
    // currentRun snapshot produced by reconnectDataReplay. A standalone DONE
    // payload may carry a valid Session+Turn identity for content routing, but
    // it must not manufacture lifecycle authority, fetch final detail, or
    // clear pending state.
    const terminalTransitionApplied = transitionResults.some(
      (transition) => transition?.phase === "terminal_state" && transition?.applied === true,
    );
    const shouldFinalizeCompletedReplay =
      state === BackendChannelState.COMPLETED &&
      hasLifecycleAuthority &&
      terminalTransitionApplied;
    // Completion/stopped/error message fields are derived by the same runtime
    // projection used by live events. Finalization below only hydrates durable
    // session content and must not patch runtime presentation state.
    if (state === BackendChannelState.USER_STOPPED) {
      await finalizeReplayStoppedSessionDetail?.({
        sessionId,
        dialogProcessId,
        turnScopeId,
        targetAssistantMessage,
        stateData,
      });
    } else if (shouldFinalizeCompletedReplay) {
      await finalizeReplayCompletedSessionDetail?.({
        sessionId,
        dialogProcessId,
        turnScopeId,
        targetAssistantMessage,
        stateData,
      });
    }
    return replayObservation();
  }
  return replayObservation();
}
