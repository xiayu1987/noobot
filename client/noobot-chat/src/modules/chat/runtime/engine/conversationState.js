/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../model/chatConstants.js";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
  resolveConnectorConnectedPayload,
} from "../interactionPayload.js";
import {
  isBlankCompatibleSameId,
  isInFlightConversationState,
  isTerminalConversationState,
  normalizeTrimmedString,
} from "./utils.js";
import {
  BackendChannelState,
  FrontendRunState,
  clearRememberedStopRequests,
  getMessageRuntimeChannelState,
} from "../sessionRunStateMachine.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
  normalizeTurnMeta,
} from "../../model/messageIdentity.js";
import {
  normalizeTimePair,
  nowIso,
  nowMs,
  parseTimeMs,
} from "../../model/timeFields.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";

function parseThinkingTimingMs(value) {
  return parseTimeMs(value);
}


export function createChatEngineConversationState({
  activeSession,
  activeSessionId,
  applyRunStateEvent,
  interactionSubmitting,
  pendingInteractionRequest,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  setPendingInteractionRequest,
  submitInteractionResponse,
  onConversationState,
  connectorTypeSet,
  upsertConnectedConnectorInPanelState,
  refreshSessionConnectorsAsync,
  notify,
  translate,
} = {}) {
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
        refreshSessionConnectorsAsync(activeSession.value?.sessionId || "");
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
  } = {}) {
    if (hasPendingInteractionForDialog(dialogProcessId)) return;
    const key = getInteractionPayloadWaitKey({ sessionId, dialogProcessId });
    if (missingInteractionPayloadTimers.has(key)) return;
    const timer = setTimeout(() => {
      missingInteractionPayloadTimers.delete(key);
      if (hasPendingInteractionForDialog(dialogProcessId)) return;
      const missingInteractionError = translate("chat.interactionPayloadMissing");
      notify({ type: "error", message: missingInteractionError });
    }, 1200);
    missingInteractionPayloadTimers.set(key, timer);
  }

  function isStateForActiveSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) return true;
    return (
      normalizedSessionId === String(activeSession.value?.sessionId || "").trim() ||
      normalizedSessionId === String(activeSession.value?.sessionId || "").trim()
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
    return (
      messageItem.pending === false &&
      isTerminalConversationState(runtimeState)
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
    const explicitDialogProcessId = String(statePayload?.dialogProcessId || "").trim();
    const fallbackDialogProcessIdValue = String(fallbackDialogProcessId || "").trim();
    const canUseFallbackTurnScopeId = Boolean(explicitDialogProcessId || fallbackDialogProcessIdValue);
    const turnScopeId = String(
      turnMeta.turnScopeId || (canUseFallbackTurnScopeId ? fallbackTurnScopeId : "") || "",
    ).trim();
    const dialogProcessId = String(
      explicitDialogProcessId || fallbackDialogProcessIdValue || "",
    ).trim();
    if (typeof onConversationState === "function") {
      onConversationState({
        source: "stream",
        state,
        sessionId,
        dialogProcessId,
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
    const targetAssistantMessage = findTargetAssistantMessageByIdentity({
      botMessage,
      turnScopeId,
      dialogProcessId,
    });
    logResendDebug("conversationState.target", () => ({
      state,
      sessionId,
      dialogProcessId,
      turnScopeId,
      fallbackTurnScopeId,
      botMessage: summarizeDebugMessage(botMessage),
      targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
    }));
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
    };
    if (targetAssistantMessage && sessionId) {
      targetAssistantMessage.sessionId = targetAssistantMessage.sessionId || sessionId;
      targetAssistantMessage.session_id = targetAssistantMessage.session_id || sessionId;
    }
    if (dialogProcessId && targetAssistantMessage) {
      if (!getMessageDialogProcessId(targetAssistantMessage)) {
        targetAssistantMessage.dialogProcessId = dialogProcessId;
      }
      markUserMessageDialogProcessId({ targetAssistantMessage, dialogProcessId });
    }
    if (isInFlightConversationState(state)) {
      if (isTerminalAssistantMessage(targetAssistantMessage)) {
        logResendDebug("conversationState.inFlight.skipFinalized", () => ({
          state,
          sessionId,
          dialogProcessId,
          turnScopeId,
          sourceEvent: String(statePayload?.sourceEvent || "").trim(),
          targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
        }));
        return;
      }
      if (
        state === BackendChannelState.SENDING &&
        String(statePayload?.sourceEvent || "").trim().toLowerCase() === "interaction_response" &&
        typeof clearPendingInteractionIfObsolete === "function"
      ) {
        const responseRequestId = String(
          statePayload?.requestId ||
            "",
        ).trim();
        if (responseRequestId) {
          clearPendingInteractionIfObsolete({ requestId: responseRequestId });
        }
      }
      if (state === BackendChannelState.INTERACTION_PENDING) {
        interactionSubmitting.value = false;
        scheduleMissingInteractionPayloadFailure({ sessionId, dialogProcessId });
      }
      return;
    }
    if (!isTerminalConversationState(state)) return;
    clearRememberedStopRequests({ sessionId, dialogProcessId, turnScopeId });
    if (typeof clearPendingInteractionIfObsolete === "function") {
      clearPendingInteractionIfObsolete({ sessionId, dialogProcessId });
    }
    clearMissingInteractionPayloadTimer({ sessionId, dialogProcessId });
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
    if (state === BackendChannelState.NO_CONVERSATION || state === BackendChannelState.EXPIRED) {
      clearPendingInteraction();
      return;
    }
    logResendDebug("conversationState.terminal.dispatched", () => ({
      state, sessionId, dialogProcessId, turnScopeId,
      target: summarizeDebugMessage(targetAssistantMessage),
    }));
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
