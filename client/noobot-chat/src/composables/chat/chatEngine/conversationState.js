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
  BackendChannelState,
  FrontendRunState,
  SESSION_RUN_EVENT,
  clearRememberedStopRequests,
  getMessageRuntimeChannelState,
} from "../sessionRunStateMachine";
import {
  bindThinkingDialogProcess,
  rememberThinkingFinished,
  rememberThinkingStarted,
} from "../thinkingTimingRegistry";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../infra/messageIdentity";
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
import { logResendDebug, summarizeDebugMessage } from "../debug/resendDebugLogger";

function parseThinkingTimingMs(value) {
  return parseTimeMs(value);
}

function applyEarliestThinkingStartedAt(targetAssistantMessage = null, nextStartedAt = "") {
  if (!targetAssistantMessage) return;
  const nextStartedAtMs = parseThinkingTimingMs(nextStartedAt);
  if (nextStartedAtMs <= 0) return;
  const currentStartedAtMs = parseThinkingTimingMs(getThinkingStartedAt(targetAssistantMessage));
  if (currentStartedAtMs > 0 && currentStartedAtMs <= nextStartedAtMs) return;
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
      state: BackendChannelState.ERROR,
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
    turnScopeId = "",
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
          state: BackendChannelState.ERROR,
          sessionId,
          dialogProcessId,
          turnScopeId,
          source: "interaction_payload_missing",
        });
      } else {
        // Compatibility fallback for callers that do not provide the run state machine bridge.
        sending.value = false;
        if (canStop) canStop.value = false;
      }
      clearPendingInteraction();
      const missingInteractionError = translate("chat.interactionPayloadMissing");
      applyAssistantFailureState(targetAssistantMessage, missingInteractionError);
      emitSyntheticErrorConversationState({
        sessionId,
        dialogProcessId,
        turnScopeId,
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
              state: BackendChannelState.ERROR,
              sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
              dialogProcessId,
              source: "expired_refresh_failed",
            });
          } else {
            // Compatibility fallback for callers that do not provide the run state machine bridge.
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
              state: BackendChannelState.ERROR,
              sessionId: normalizeTrimmedString(sessionId || activeSession.value?.id),
              dialogProcessId,
              source: "expired_refresh_failed",
            });
          } else {
            // Compatibility fallback for callers that do not provide the run state machine bridge.
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
      if (getMessageRole(messageItem) !== RoleEnum.USER) continue;
      const currentDialogProcessId = getMessageDialogProcessId(messageItem);
      if (currentDialogProcessId && currentDialogProcessId !== normalizedDialogProcessId) {
        return false;
      }
      messageItem.dialogProcessId = normalizedDialogProcessId;
      return true;
    }
    return false;
  }

  function canApplyStateToBotMessage({ botMessage = null, explicitTurnScopeId = "" } = {}) {
    if (!botMessage || getMessageRole(botMessage) !== RoleEnum.ASSISTANT) return false;
    const botTurnScopeId = getMessageTurnScopeId(botMessage);
    if (!botTurnScopeId) return true;
    return Boolean(explicitTurnScopeId && explicitTurnScopeId === botTurnScopeId);
  }

  function findTargetAssistantMessage({ botMessage = null, turnScopeId = "" } = {}) {
    const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
    if (canApplyStateToBotMessage({ botMessage, explicitTurnScopeId: normalizedTurnScopeId })) return botMessage;
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    if (!normalizedTurnScopeId) return null;
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
      if (getMessageTurnScopeId(messageItem) === normalizedTurnScopeId) return messageItem;
    }
    return null;
  }

  function findTargetAssistantMessageByIdentity({ botMessage = null, turnScopeId = "", dialogProcessId = "" } = {}) {
    const normalizedTurnScopeId = normalizeTrimmedString(turnScopeId);
    const normalizedDialogProcessId = normalizeTrimmedString(dialogProcessId);
    const directTarget = findTargetAssistantMessage({ botMessage, turnScopeId: normalizedTurnScopeId });
    if (directTarget) return directTarget;
    if (!normalizedDialogProcessId) return null;
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
      if (getMessageDialogProcessId(messageItem) === normalizedDialogProcessId) return messageItem;
    }
    return null;
  }

  function isTerminalAssistantMessage(messageItem = null) {
    if (!messageItem || getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
    const runtimeState = normalizeTrimmedString(
      getMessageRuntimeChannelState(messageItem)?.state || messageItem?.channelState,
    );
    const directState = normalizeTrimmedString(messageItem?.state || messageItem?.status);
    const stopState = normalizeTrimmedString(messageItem?.stopState);
    return (
      messageItem.pending === false &&
      (
        isTerminalConversationState(runtimeState) ||
        isTerminalConversationState(directState) ||
        stopState === BackendChannelState.STOPPED ||
        stopState === FrontendRunState.CANCELLED
      )
    );
  }

  function applyConversationState(
    statePayload = {},
    {
      botMessage = null,
      fallbackDialogProcessId = "",
      fallbackTurnScopeId = "",
    } = {},
  ) {
    const state = String(statePayload?.state || "").trim();
    if (!state) return;
    const sessionId = String(statePayload?.sessionId || "").trim();
    const { createdAtMs, updatedAtMs, createdAt, updatedAt } = normalizeTimePair(statePayload);
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    const botMessageInActiveSession = Boolean(
      botMessage &&
      getMessageRole(botMessage) === RoleEnum.ASSISTANT &&
      messageList.includes(botMessage),
    );
    const forActiveSession = isStateForActiveSession(sessionId) || botMessageInActiveSession;
    const turnMeta = normalizeTurnMeta(statePayload);
    const turnScopeId = String(turnMeta.turnScopeId || "").trim();
    const explicitDialogProcessId = String(statePayload?.dialogProcessId || "").trim();
    if (typeof onConversationState === "function") {
      onConversationState({
        source: "stream",
        state,
        sessionId,
        dialogProcessId: String(
          statePayload?.dialogProcessId || fallbackDialogProcessId || "",
        ).trim(),
        turnScopeId,
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
      explicitDialogProcessId || "",
    ).trim();
    const targetAssistantMessage = findTargetAssistantMessageByIdentity({
      botMessage,
      turnScopeId,
      dialogProcessId: explicitDialogProcessId,
    });
    logResendDebug("conversationState.target", {
      state,
      sessionId,
      dialogProcessId,
      turnScopeId,
      fallbackTurnScopeId,
      botMessage: summarizeDebugMessage(botMessage),
      targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
    });
    const channelStateView = {
      ...(targetAssistantMessage?.channelState &&
      typeof targetAssistantMessage.channelState === "object" &&
      !Array.isArray(targetAssistantMessage.channelState)
        ? targetAssistantMessage.channelState
        : {}),
      state,
      sessionId,
      dialogProcessId,
      turnScopeId,
      sourceEvent: String(statePayload?.sourceEvent || "").trim(),
      seq: Number(statePayload?.seq || 0),
      createdAtMs:
        createdAtMs ||
        Number(targetAssistantMessage?.channelState?.createdAtMs || 0),
      updatedAtMs,
      createdAt:
        createdAt ||
        String(targetAssistantMessage?.channelState?.createdAt || targetAssistantMessage?.thinkingStartedAt || ""),
      updatedAt,
    };
    if (targetAssistantMessage && sessionId) {
      targetAssistantMessage.sessionId = targetAssistantMessage.sessionId || sessionId;
      targetAssistantMessage.session_id = targetAssistantMessage.session_id || sessionId;
    }
    if (dialogProcessId && targetAssistantMessage) {
      if (!getMessageDialogProcessId(targetAssistantMessage)) {
        targetAssistantMessage.dialogProcessId = dialogProcessId;
      }
      bindThinkingDialogProcess({ sessionId, dialogProcessId, turnScopeId });
      markUserMessageDialogProcessId({ targetAssistantMessage, dialogProcessId });
    }
    if (isInFlightConversationState(state)) {
      if (isTerminalAssistantMessage(targetAssistantMessage)) {
        logResendDebug("conversationState.inFlight.skipFinalized", {
          state,
          sessionId,
          dialogProcessId,
          turnScopeId,
          sourceEvent: String(statePayload?.sourceEvent || "").trim(),
          targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
        });
        return;
      }
      if (applyRunStateEvent) {
        applyRunStateEvent({
          type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
          state,
          sessionId,
          dialogProcessId,
          turnScopeId,
          source: "stream",
          sourceEvent: String(statePayload?.sourceEvent || "").trim(),
          seq: Number(statePayload?.seq || 0),
          createdAtMs,
          updatedAtMs,
          createdAt,
          updatedAt,
        });
      } else {
        // Compatibility fallback for callers that do not provide the run state machine bridge.
        sending.value = true;
        if (canStop) {
          canStop.value = [
            BackendChannelState.SENDING,
            BackendChannelState.RECONNECTING,
            BackendChannelState.INTERACTION_PENDING,
          ].includes(state);
        }
      }
      if (
        state === BackendChannelState.SENDING &&
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
      if (state === BackendChannelState.INTERACTION_PENDING) {
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
            turnScopeId,
            targetAssistantMessage,
          });
          return;
        }
      }
      rememberThinkingStarted({
        sessionId,
        dialogProcessId,
        turnScopeId,
      startedAtMs: resolveThinkingStartedAtMs(targetAssistantMessage, createdAtMs),
        updatedAtMs,
      });
      if (targetAssistantMessage) {
        targetAssistantMessage.channelState = channelStateView;
        applyEarliestThinkingStartedAt(targetAssistantMessage, channelStateView.createdAt || channelStateView.createdAtMs);
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
    if (!isTerminalConversationState(state)) return;
    clearRememberedStopRequests({ sessionId, dialogProcessId, turnScopeId });
    rememberThinkingFinished({
      sessionId,
      dialogProcessId,
      turnScopeId,
      finishedAtMs: updatedAtMs || nowMs(),
      finishedAt: updatedAt,
    });
    if (applyRunStateEvent) {
      applyRunStateEvent({
        type: SESSION_RUN_EVENT.BACKEND_CHANNEL_STATE,
        state,
        sessionId,
        dialogProcessId,
        turnScopeId,
        source: "stream",
        sourceEvent: String(statePayload?.sourceEvent || "").trim(),
        seq: Number(statePayload?.seq || 0),
        createdAtMs,
        updatedAtMs,
        createdAt,
        updatedAt,
      });
    } else {
      // Compatibility fallback for callers that do not provide the run state machine bridge.
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
    if (state === BackendChannelState.EXPIRED) {
      scheduleCacheExpiredSessionRefresh({ sessionId, dialogProcessId, targetAssistantMessage });
    }
    if (state === BackendChannelState.NO_CONVERSATION || state === BackendChannelState.EXPIRED) {
      clearPendingInteraction();
      return;
    }
    if (!targetAssistantMessage) return;
    if (state === BackendChannelState.COMPLETED) {
      const beforeTerminalApply = summarizeDebugMessage(targetAssistantMessage);
      const currentMessageState = normalizeTrimmedString(
        getMessageRuntimeChannelState(targetAssistantMessage)?.state,
      );
      if (
        targetAssistantMessage.pending === false ||
        [
          FrontendRunState.FRONTEND_COMPLETED,
          BackendChannelState.ERROR,
          BackendChannelState.STOPPED,
          FrontendRunState.CANCELLED,
        ].includes(currentMessageState)
      ) {
        logResendDebug("conversationState.backendCompleted.skipFinalized", {
          state, sessionId, dialogProcessId, turnScopeId,
          currentMessageState,
          before: beforeTerminalApply,
        });
        return;
      }
      targetAssistantMessage.channelState = channelStateView;
      applyEarliestThinkingStartedAt(targetAssistantMessage, channelStateView.createdAt || channelStateView.createdAtMs);
      setThinkingFinishedAt(targetAssistantMessage, getThinkingFinishedAt(targetAssistantMessage) || updatedAt || createdAt || nowIso());
      logResendDebug("conversationState.backendCompleted.apply", {
        state, sessionId, dialogProcessId, turnScopeId,
        before: beforeTerminalApply,
        after: summarizeDebugMessage(targetAssistantMessage),
      });
      return;
    }
    const beforeTerminalApply = summarizeDebugMessage(targetAssistantMessage);
    targetAssistantMessage.channelState = channelStateView;
    applyEarliestThinkingStartedAt(targetAssistantMessage, channelStateView.createdAt || channelStateView.createdAtMs);
    setThinkingFinishedAt(targetAssistantMessage, getThinkingFinishedAt(targetAssistantMessage) || updatedAt || createdAt || nowIso());
    targetAssistantMessage.pending = false;
    if (state === FrontendRunState.FRONTEND_COMPLETED) {
      targetAssistantMessage.statusLabel = translate("chat.generated");
      logResendDebug("conversationState.terminal.apply", {
        state, sessionId, dialogProcessId, turnScopeId,
        before: beforeTerminalApply,
        after: summarizeDebugMessage(targetAssistantMessage),
      });
      return;
    }
    if (state === BackendChannelState.STOPPED || state === FrontendRunState.CANCELLED) {
      targetAssistantMessage.statusLabel = translate("chat.stopped");
      if (!String(targetAssistantMessage.content || "").trim()) {
        targetAssistantMessage.content = translate("chat.stoppedContent");
      }
      logResendDebug("conversationState.terminal.apply", {
        state, sessionId, dialogProcessId, turnScopeId,
        before: beforeTerminalApply,
        after: summarizeDebugMessage(targetAssistantMessage),
      });
      return;
    }
    if (state === BackendChannelState.ERROR) {
      targetAssistantMessage.statusLabel = translate("chat.failed");
    }
    logResendDebug("conversationState.terminal.apply", {
      state, sessionId, dialogProcessId, turnScopeId,
      before: beforeTerminalApply,
      after: summarizeDebugMessage(targetAssistantMessage),
    });
  }

  function applyConversationStateFromEvent(
    eventName = "",
    eventData = {},
    {
      botMessage = null,
      fallbackDialogProcessId = "",
      fallbackTurnScopeId = "",
    } = {},
  ) {
    const normalizedEvent = String(eventName || "").trim();
    if (normalizedEvent !== StreamEventEnum.CHANNEL_STATE) return;
    applyConversationState(eventData, {
      botMessage,
      fallbackDialogProcessId,
      fallbackTurnScopeId,
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
