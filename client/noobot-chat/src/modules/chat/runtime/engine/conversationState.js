/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_CHANNEL_STATE_SCOPE,
  AGENT_COMMAND,
  validateAgentChannelState,
} from "@noobot/agent-transport-protocol";
import { RoleEnum, StreamEventEnum } from "../../model/chatConstants.js";
import {
  isAutoResolvedInteraction,
  normalizeInteractionRequestPayload,
} from "../interactionPayload.js";
import {
  AGENT_CHANNEL_STATE,
  getMessageRuntimeChannelState,
  isInFlightChannelState,
  isTerminalChannelState,
} from "../sessionRunStateMachine.js";
import { getMessageRole, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { text } from "@noobot/shared/value";

const MISSING_INTERACTION_PAYLOAD_WAIT_MS = 1200;

export function createChatEngineConversationState({
  activeSession,
  interactionSubmitting,
  pendingInteractionRequest,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  submitInteractionResponse,
  onConversationState,
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
    const requestId = text(request?.requestId);
    if (requestId && connectorConnectedAckedRequestIds.has(requestId)) {
      return true;
    }
    if (request?.requestId) {
      try {
        submitInteractionResponse(
          {
            confirmed: true,
            response: text(request?.interactionType)
              ? `${String(request.interactionType).trim()}_ack`
              : "interaction_auto_ack",
          },
          {
            requestId: request.requestId,
            requireEncryption: request.requireEncryption === true,
            sessionId: String(request.sessionId || ""),
          },
        );
      } catch (error) {
        notify?.({ type: "error", message: error?.message || translate?.("common.error") });
        return false;
      }
    }
    if (requestId) connectorConnectedAckedRequestIds.add(requestId);
    clearPendingInteraction(request);
    return true;
  }

  function interactionPayloadWaitKey({ sessionId = "", turnScopeId = "" } = {}) {
    return `${text(sessionId)}::${text(turnScopeId)}`;
  }

  function clearMissingInteractionPayloadTimer({ sessionId = "", turnScopeId = "" } = {}) {
    const key = interactionPayloadWaitKey({ sessionId, turnScopeId });
    const timer = missingInteractionPayloadTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    missingInteractionPayloadTimers.delete(key);
  }

  function hasPendingInteractionForTurn(turnScopeId = "") {
    const pendingRequest = pendingInteractionRequest.value;
    if (!pendingRequest) return false;
    return text(pendingRequest.turnScopeId) === text(turnScopeId);
  }

  function scheduleMissingInteractionPayloadFailure({ sessionId = "", turnScopeId = "" } = {}) {
    if (hasPendingInteractionForTurn(turnScopeId)) return;
    const key = interactionPayloadWaitKey({ sessionId, turnScopeId });
    if (missingInteractionPayloadTimers.has(key)) return;
    const timer = setTimeout(() => {
      missingInteractionPayloadTimers.delete(key);
      if (hasPendingInteractionForTurn(turnScopeId)) return;
      notify({ type: "error", message: translate("chat.interactionPayloadMissing") });
    }, MISSING_INTERACTION_PAYLOAD_WAIT_MS);
    missingInteractionPayloadTimers.set(key, timer);
  }

  function findTurnAssistantMessage(turnScopeId = "") {
    const messageList = Array.isArray(activeSession.value?.messages)
      ? activeSession.value.messages
      : [];
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
      if (getMessageTurnScopeId(messageItem) === turnScopeId) return messageItem;
    }
    return null;
  }

  function isTerminalAssistantMessage(messageItem = null) {
    if (!messageItem) return false;
    const runtimeState = text(getMessageRuntimeChannelState(messageItem)?.state);
    return messageItem.pending === false && isTerminalChannelState(runtimeState);
  }

  function applySessionChannelState({ state, sessionId }) {
    if (!isTerminalChannelState(state)) return;
    clearPendingInteraction();
    logResendDebug("conversationState.session.terminal", () => ({ state, sessionId }));
  }

  function applyTurnInFlightState(channelState, targetAssistantMessage) {
    const { state, sessionId, turnScopeId } = channelState;
    if (isTerminalAssistantMessage(targetAssistantMessage)) {
      logResendDebug("conversationState.inFlight.skipFinalized", () => ({
        state,
        sessionId,
        turnScopeId,
        sourceEvent: channelState.sourceEvent,
        targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
      }));
      return;
    }
    if (
      state === AGENT_CHANNEL_STATE.SENDING &&
      channelState.sourceEvent === AGENT_COMMAND.INTERACTION_RESPONSE &&
      text(channelState.requestId)
    ) {
      clearPendingInteractionIfObsolete({ requestId: text(channelState.requestId) });
    }
    if (state === AGENT_CHANNEL_STATE.INTERACTION_PENDING) {
      interactionSubmitting.value = false;
      scheduleMissingInteractionPayloadFailure({ sessionId, turnScopeId });
    }
  }

  function applyTurnChannelState(channelState) {
    const { state, sessionId, turnScopeId } = channelState;
    const targetAssistantMessage = findTurnAssistantMessage(turnScopeId);
    logResendDebug("conversationState.target", () => ({
      state,
      sessionId,
      turnScopeId,
      targetAssistantMessage: summarizeDebugMessage(targetAssistantMessage),
    }));
    if (isInFlightChannelState(state)) {
      applyTurnInFlightState(channelState, targetAssistantMessage);
      return;
    }
    if (!isTerminalChannelState(state)) return;
    clearMissingInteractionPayloadTimer({ sessionId, turnScopeId });
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
  }

  function applyConversationState(channelState = {}) {
    const validation = validateAgentChannelState(channelState);
    if (!validation.valid) {
      logResendDebug("conversationState.invalid", () => ({ errors: validation.errors }));
      return;
    }
    const applied = channelState.sessionId === text(activeSession.value?.sessionId);
    onConversationState?.({ source: "stream", ...channelState, applied });
    if (!applied) return;
    if (channelState.scope === AGENT_CHANNEL_STATE_SCOPE.SESSION) {
      applySessionChannelState(channelState);
      return;
    }
    applyTurnChannelState(channelState);
  }

  function applyConversationStateFromEvent(eventName = "", eventData = {}) {
    if (text(eventName) !== StreamEventEnum.CHANNEL_STATE) return;
    applyConversationState(eventData);
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
    tryAutoResolveInteraction,
  };
}
