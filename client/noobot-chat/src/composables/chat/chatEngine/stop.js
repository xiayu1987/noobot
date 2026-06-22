/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { normalizeTrimmedString } from "./utils";
import {
  SESSION_RUN_EVENT,
  rememberStopRequestedEvent,
} from "../sessionRunStateMachine";
import {
  getMessageClientTurnId,
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
} from "../../infra/messageIdentity";

function markLatestUserMessageStopped(activeSession, pendingAssistantMessage = null) {
  const messages = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  const rawMessages = Array.isArray(activeSession?.value?.rawMessages)
    ? activeSession.value.rawMessages
    : [];
  const pendingDialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const latestUserMessageIndex = messages
    .map((messageItem, index) => ({ messageItem, index }))
    .reverse()
    .find(({ messageItem }) => {
      if (getMessageRole(messageItem) !== RoleEnum.USER) return false;
      if (!pendingDialogProcessId) return true;
      const userDialogProcessId = getMessageDialogProcessId(messageItem);
      return !userDialogProcessId || userDialogProcessId === pendingDialogProcessId;
    });
  const latestUserMessage = latestUserMessageIndex?.messageItem;
  if (!latestUserMessage) return;
  const markStopped = (messageItem) => {
    if (!messageItem || typeof messageItem !== "object") return;
    if (pendingDialogProcessId && !getMessageDialogProcessId(messageItem)) {
      messageItem.dialogProcessId = pendingDialogProcessId;
    }
    messageItem.stopState = "stopped";
    messageItem.monotonicState = "monotonic";
    messageItem.isMonotonic = true;
    messageItem.monotonic = true;
  };
  markStopped(latestUserMessage);
  const rawCandidate = rawMessages[latestUserMessageIndex.index];
  if (rawCandidate && getMessageRole(rawCandidate) === RoleEnum.USER) {
    markStopped(rawCandidate);
    return;
  }
  const latestUserContent = normalizeTrimmedString(latestUserMessage?.content);
  for (let index = rawMessages.length - 1; index >= 0; index -= 1) {
    const rawMessage = rawMessages[index];
    if (getMessageRole(rawMessage) !== RoleEnum.USER) continue;
    const rawDialogProcessId = getMessageDialogProcessId(rawMessage);
    if (pendingDialogProcessId && rawDialogProcessId && rawDialogProcessId !== pendingDialogProcessId) continue;
    if (!pendingDialogProcessId && latestUserContent && normalizeTrimmedString(rawMessage?.content) !== latestUserContent) continue;
    markStopped(rawMessage);
    return;
  }
}

export function forceStopUiFinalize({
  sending,
  canStop,
  applyRunStateEvent,
  activeSession,
  findTargetAssistantMessage,
  applyConversationState,
  chatWebSocketClient,
} = {}) {
  if (!sending?.value) return;
  const pendingAssistantMessage = findTargetAssistantMessage?.();
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  const fallbackDialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const fallbackClientTurnId = getMessageClientTurnId(pendingAssistantMessage);
  const finalizedAtMs = Date.now();
  applyConversationState?.(
    {
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      clientTurnId: fallbackClientTurnId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
    },
    { botMessage: pendingAssistantMessage },
  );
  if (applyRunStateEvent) {
    applyRunStateEvent({
      type: SESSION_RUN_EVENT.BACKEND_CONVERSATION_STATE,
      state: "stopped",
      sessionId: String(activeSession?.value?.backendSessionId || activeSession?.value?.id || ""),
      dialogProcessId: fallbackDialogProcessId,
      clientTurnId: fallbackClientTurnId,
      createdAtMs: finalizedAtMs,
      updatedAtMs: finalizedAtMs,
      source: "force_stop_finalize",
    });
  } else {
    sending.value = false;
    if (canStop) canStop.value = false;
  }
  chatWebSocketClient?.clearLastReceivedSeqMap?.();
  chatWebSocketClient?.dispose?.();
}

function buildStopPayload({ userId, activeSession, pendingAssistantMessage } = {}) {
  const session = activeSession?.value || {};
  const dialogProcessId = getMessageDialogProcessId(pendingAssistantMessage);
  const clientTurnId = getMessageClientTurnId(pendingAssistantMessage);
  const createdAtMs = Date.now();
  const payload = {
    userId: String(userId?.value ?? userId ?? ""),
    sessionId: String(session.backendSessionId || session.sessionId || session.id || ""),
    dialogProcessId,
    clientTurnId,
    createdAtMs,
    parentSessionId: String(
      session.parentSessionId || pendingAssistantMessage?.parentSessionId || "",
    ),
    parentDialogProcessId: String(
      getMessageParentDialogProcessId(pendingAssistantMessage) || session.parentDialogProcessId || "",
    ),
    partialAssistant: {
      content: String(pendingAssistantMessage?.content || ""),
      dialogProcessId,
      clientTurnId,
      createdAtMs,
      modelAlias: String(pendingAssistantMessage?.modelAlias || ""),
      modelName: String(pendingAssistantMessage?.modelName || ""),
    },
  };
  Object.keys(payload).forEach((key) => {
    if (key !== "partialAssistant" && !normalizeTrimmedString(payload[key])) delete payload[key];
  });
  return payload;
}

export function stopSending({
  sending,
  canStop,
  activeSession,
  userId,
  chatWebSocketClient,
  onForceStopUiFinalize,
  applyRunStateEvent,
} = {}) {
  if (!sending?.value) return false;
  if (canStop && canStop.value === false) return false;
  const pendingAssistantMessage = [...(activeSession?.value?.messages || [])]
    .reverse()
    .find(
      (messageItem) =>
        getMessageRole(messageItem) === RoleEnum.ASSISTANT &&
        Boolean(messageItem?.pending),
    );
  markLatestUserMessageStopped(activeSession, pendingAssistantMessage);
  const stopPayload = buildStopPayload({ userId, activeSession, pendingAssistantMessage });
  const stopEvent = rememberStopRequestedEvent({
    sessionId: stopPayload.sessionId,
    dialogProcessId: stopPayload.dialogProcessId,
    clientTurnId: stopPayload.clientTurnId,
    createdAtMs: stopPayload.createdAtMs,
    source: "stop_sending",
  });
  if (applyRunStateEvent) {
    applyRunStateEvent(stopEvent);
  } else if (canStop) {
    canStop.value = false;
  }
  return chatWebSocketClient?.requestStop?.(
    stopPayload,
    onForceStopUiFinalize,
  );
}
