/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import { isMessageEventEnvelope } from "@noobot/shared/message-event-protocol";
import { getMessageDialogProcessId, getMessageTurnScopeId } from "../../model/messageIdentity.js";
import { nowMs } from "../../model/timeFields.js";
import {
  resolveSessionTurnRuntime,
  sessionRuntimeId,
  turnRuntimeDisplayState,
} from "../run-state-machine/turnRuntimeRegistry.js";
import { normalizeTrimmedString } from "./utils.js";

export function createTurnScopeId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `client-turn:${randomUuid}`;
  return `client-turn:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function createAssistantMessageId() {
  const randomUuid = globalThis?.crypto?.randomUUID?.();
  if (randomUuid) return `msg_${randomUuid}`;
  return `msg_${nowMs().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

export function isUserStoppedEvent(event = "") {
  return normalizeTrimmedString(event) === StreamEventEnum.USER_STOPPED;
}

export function isCompletedChannelStateEvent(event = "", data = {}) {
  return normalizeTrimmedString(event) === StreamEventEnum.CHANNEL_STATE &&
    normalizeTrimmedString(data?.state) === "completed";
}

export function requirePersistedTurnStatus(data = {}, expectedStatus = "") {
  const turnStatus = data?.turnStatus;
  if (!turnStatus) return null;
  const actualStatus = normalizeTrimmedString(turnStatus?.status).toLowerCase();
  if (actualStatus !== expectedStatus) {
    const error = new Error(
      `terminal event is missing persisted turn status confirmation: expected ${expectedStatus || "unknown"}`,
    );
    error.code = "invalid_terminal_turn_status";
    error.data = data;
    throw error;
  }
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const statusTurnScopeId = normalizeTrimmedString(turnStatus?.turnScopeId);
  const statusDialogProcessId = normalizeTrimmedString(turnStatus?.dialogProcessId);
  if (
    (eventTurnScopeId && statusTurnScopeId && eventTurnScopeId !== statusTurnScopeId) ||
    (eventDialogProcessId && statusDialogProcessId && eventDialogProcessId !== statusDialogProcessId)
  ) {
    const error = new Error("terminal event turn identity does not match persisted turn status");
    error.code = "invalid_terminal_turn_status_identity";
    error.data = data;
    throw error;
  }
  return turnStatus;
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
    sessionId: data?.sessionId || activeSession?.value?.backendSessionId || activeSession?.value?.id || "",
    dialogProcessId: data?.dialogProcessId || normalizeTrimmedString(botMessage?.dialogProcessId),
    turnScopeId: data?.turnScopeId || normalizeTrimmedString(botMessage?.turnScopeId),
  };
}

export function hasDialogProcessConflictForTurn({ activeSession, data = {}, botMessage = {} } = {}) {
  const eventDialogProcessId = normalizeTrimmedString(data?.dialogProcessId);
  const eventTurnScopeId = normalizeTrimmedString(data?.turnScopeId);
  const botTurnScopeId = getMessageTurnScopeId(botMessage);
  if (!eventDialogProcessId || !eventTurnScopeId || !botTurnScopeId) return false;
  if (eventTurnScopeId !== botTurnScopeId) return false;
  const messages = Array.isArray(activeSession?.value?.messages) ? activeSession.value.messages : [];
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
  return ["requesting", "sending", "completing", "stopping"].includes(turnRuntimeDisplayState(turn));
}

export function shouldProjectSubSessionEvent(event = "", data = {}) {
  return event === "subagent_message_event" &&
    data?.channelKind === "message_event" &&
    Number(data?.channelVersion) === 1 &&
    isMessageEventEnvelope(data?.event);
}

export function shouldProjectMainSessionEvent(event = "", data = {}) {
  return event === "message_event" &&
    data?.channelKind === "message_event" &&
    Number(data?.channelVersion) === 1 &&
    data?.route?.scope === "main_session" &&
    isMessageEventEnvelope(data?.event);
}
