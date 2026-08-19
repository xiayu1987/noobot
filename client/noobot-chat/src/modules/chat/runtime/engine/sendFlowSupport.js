/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { EVENT_FAMILY, validateProtocolEvent } from "@noobot/event-protocol";
import { MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { getMessageDialogProcessId, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import {
  resolveSessionTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { normalizeTrimmedString } from "./utils.js";
import { createSecureId } from "../../../../shared/identity/secureIdentity.js";

export function createTurnScopeId() {
  return createSecureId("client-turn");
}

export function createAssistantMessageId() {
  return createSecureId("msg", "_");
}

export function createUserMessageId() {
  return createAssistantMessageId();
}

export function isEventForCurrentTurn(data = {}, botMessage = {}) {
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  if (!botTurnScopeId || !eventTurnScopeId) return true;
  return eventTurnScopeId === botTurnScopeId;
}

export function isCompletedChannelStateEvent(event = "", data = {}) {
  return (
    normalizeTrimmedString(event) === StreamEventEnum.CHANNEL_STATE &&
    normalizeTrimmedString(data?.state) === "completed"
  );
}

export function hasCompletableRunIdentity(data = {}, botMessage = {}) {
  return Boolean(
    normalizeTrimmedString(data?.turnScopeId) ||
    normalizeTrimmedString(data?.dialogProcessId) ||
    normalizeTrimmedString(botMessage?.dialogProcessId),
  );
}

export function buildFinalDoneEventData({ data = {}, activeSession, botMessage } = {}) {
  return {
    ...(data || {}),
    sessionId: data?.sessionId || activeSession?.value?.sessionId || "",
    dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMessage?.dialogProcessId),
    turnScopeId: data?.turnScopeId || normalizeTrimmedString(botMessage?.turnScopeId),
  };
}

export function hasDialogProcessConflictForTurn({
  activeSession,
  data = {},
  botMessage = {},
} = {}) {
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  if (!eventDialogProcessId || !eventTurnScopeId || !botTurnScopeId) return false;
  if (eventTurnScopeId !== botTurnScopeId) return false;
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  return messages.some((messageItem) => {
    if (messageItem === botMessage) return false;
    if (getMessageDialogProcessId(messageItem) !== eventDialogProcessId) return false;
    const messageTurnScopeId = getMessageTurnScopeId(messageItem);
    return Boolean(messageTurnScopeId && messageTurnScopeId !== botTurnScopeId);
  });
}

export function hasActiveTurnInFlight({ activeSession, turnRuntimeRegistry } = {}) {
  const sessionId = sessionRuntimeId(activeSession?.value);
  const turn = resolveSessionTurnRuntime(turnRuntimeRegistry?.value, sessionId);
  return ["requesting", "sending", "completing", "stopping"].includes(
    turnRuntimeDisplayState(turn),
  );
}

export function shouldProjectSubSessionEvent(event = "", data = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return false;
  const result = validateProtocolEvent(data);
  return (
    result.valid &&
    result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    Boolean(data?.payload?.workflowRunId && data?.payload?.nodeExecutionId)
  );
}

export function shouldProjectMainSessionEvent(event = "", data = {}) {
  if (event !== MESSAGE_EVENT_WIRE_EVENT) return false;
  const result = validateProtocolEvent(data);
  return (
    result.valid &&
    result.descriptor?.family === EVENT_FAMILY.MESSAGE_TIMELINE &&
    !data?.payload?.workflowRunId &&
    !data?.payload?.nodeExecutionId
  );
}
