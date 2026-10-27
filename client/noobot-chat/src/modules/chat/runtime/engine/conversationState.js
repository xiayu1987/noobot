/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  AGENT_CHANNEL_STATE,
  AGENT_CHANNEL_STATE_SCOPE,
  AGENT_COMMAND,
  isInFlightAgentChannelState,
  isTerminalAgentChannelState,
} from "@noobot/agent-transport-protocol";
import { RoleEnum } from "../../model/chatConstants.js";
import { isFinalizedAssistantMessage } from "../sessionRunStateMachine.js";
import { getMessageRole, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { logResendDebug, summarizeDebugMessage } from "../../../debug/loggers/resendDebugLogger.js";
import { text, isObjectLike, requireFunctionDependencies } from "@noobot/shared/value";

const MISSING_INTERACTION_PAYLOAD_WAIT_MS = 1200;

export function createChatEngineConversationState({
  activeSession,
  interactionSubmitting,
  pendingInteractionRequest,
  clearPendingInteraction,
  clearPendingInteractionIfObsolete,
  onConversationState,
  notify,
  translate,
}) {
  requireFunctionDependencies("createChatEngineConversationState", {
    clearPendingInteraction,
    clearPendingInteractionIfObsolete,
    onConversationState,
    notify,
    translate,
  });
  const missingInteractionPayloadTimers = new Map();

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
    const messageList = activeSession.value.messages;
    for (let messageIndex = messageList.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const messageItem = messageList[messageIndex];
      if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) continue;
      if (getMessageTurnScopeId(messageItem) === turnScopeId) return messageItem;
    }
    return null;
  }

  function applySessionChannelState({ state, sessionId }) {
    if (!isTerminalAgentChannelState(state)) return;
    clearPendingInteraction();
    logResendDebug("conversationState.session.terminal", () => ({ state, sessionId }));
  }

  function applyTurnInFlightState(channelState, targetAssistantMessage) {
    const { state, sessionId, turnScopeId } = channelState;
    if (targetAssistantMessage && isFinalizedAssistantMessage(targetAssistantMessage)) {
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
    if (isInFlightAgentChannelState(state)) {
      applyTurnInFlightState(channelState, targetAssistantMessage);
      return;
    }
    if (!isTerminalAgentChannelState(state)) return;
    clearMissingInteractionPayloadTimer({ sessionId, turnScopeId });
    if (!pendingInteractionRequest.value) {
      interactionSubmitting.value = false;
    }
  }

  function applyConversationState(channelState) {
    const currentSession = activeSession.value;
    const applied =
      isObjectLike(currentSession) && channelState.sessionId === text(currentSession.sessionId);
    onConversationState({ source: "stream", ...channelState, applied });
    if (!applied) return;
    if (channelState.scope === AGENT_CHANNEL_STATE_SCOPE.SESSION) {
      applySessionChannelState(channelState);
      return;
    }
    applyTurnChannelState(channelState);
  }

  function disposeConversationState() {
    for (const timer of missingInteractionPayloadTimers.values()) {
      clearTimeout(timer);
    }
    missingInteractionPayloadTimers.clear();
  }

  return {
    applyConversationState,
    clearMissingInteractionPayloadTimer,
    disposeConversationState,
  };
}
