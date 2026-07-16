/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum, StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  collectReconnectDeltaText,
  findLatestPendingAssistantAfterLastUser,
} from "../../infra/reconnectReplayModel";
import { _ensureArray, _isAssistantRole, _matchesDialogProcessId, _trimStr } from "./utils";
import {
  findAssistantMessageByDialogProcessId,
  hasAssistantMessageWithContent,
} from "./messageLookup";
import { logReconnectTimingDebug } from "../debug/reconnectTimingDebugLogger";

export function resolveReconnectTargetAssistantMessage({
  activeSession,
  appendMessage,
  dialogProcessId = "",
  turnScopeId = "",
  allowCreate = true,
} = {}) {
  if (!activeSession?.value) return null;
  const normalizedDpId = _trimStr(dialogProcessId);
  const normalizedTurnScopeId = _trimStr(turnScopeId);
  const messageList = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  const matchedAssistantMessage = messageList.find(
    (messageItem) =>
      normalizedDpId &&
      _isAssistantRole(messageItem) &&
      _matchesDialogProcessId(messageItem, normalizedDpId),
  );
  if (matchedAssistantMessage) {
    if (normalizedTurnScopeId && !matchedAssistantMessage.turnScopeId) {
      matchedAssistantMessage.turnScopeId = normalizedTurnScopeId;
    }
    logReconnectTimingDebug("frontend.reconnectTiming.assistantResolved", {
      dialogProcessId: normalizedDpId,
      inputTurnScopeId: normalizedTurnScopeId,
      messageTurnScopeId: _trimStr(matchedAssistantMessage.turnScopeId),
      matched: Boolean(normalizedTurnScopeId && normalizedTurnScopeId === _trimStr(matchedAssistantMessage.turnScopeId)),
      resolution: "dialog-process-match",
    });
    return matchedAssistantMessage.pending ? matchedAssistantMessage : null;
  }

  const latestPendingAssistant = findLatestPendingAssistantAfterLastUser(messageList);
  if (latestPendingAssistant) {
    const latestPendingDpId = _trimStr(latestPendingAssistant?.dialogProcessId);
    if (normalizedDpId && latestPendingDpId && latestPendingDpId !== normalizedDpId) {
      return null;
    }
    if (normalizedDpId && !latestPendingDpId) {
      latestPendingAssistant.dialogProcessId = normalizedDpId;
    }
    if (normalizedTurnScopeId && !latestPendingAssistant.turnScopeId) {
      latestPendingAssistant.turnScopeId = normalizedTurnScopeId;
    }
    logReconnectTimingDebug("frontend.reconnectTiming.assistantResolved", {
      dialogProcessId: normalizedDpId,
      inputTurnScopeId: normalizedTurnScopeId,
      messageTurnScopeId: _trimStr(latestPendingAssistant.turnScopeId),
      resolution: "latest-pending-match",
    });
    return latestPendingAssistant;
  }
  if (!allowCreate) return null;
  const appendedMessage = appendMessage(RoleEnum.ASSISTANT, "");
  appendedMessage.pending = true;
  appendedMessage.statusLabel = "";
  if (normalizedDpId) {
    appendedMessage.dialogProcessId = normalizedDpId;
  }
  if (normalizedTurnScopeId) {
    appendedMessage.turnScopeId = normalizedTurnScopeId;
  }
  logReconnectTimingDebug("frontend.reconnectTiming.assistantResolved", {
    dialogProcessId: normalizedDpId,
    inputTurnScopeId: normalizedTurnScopeId,
    messageTurnScopeId: _trimStr(appendedMessage.turnScopeId),
    resolution: "created",
  });
  return appendedMessage;
}

export function hasReconnectInFlightEvent(messages = []) {
  return (_ensureArray(messages)).some((envelope) => {
    const eventName = _trimStr(envelope?.event);
    return (
      eventName === StreamEventEnum.DELTA ||
      eventName === StreamEventEnum.THINKING ||
      eventName === StreamEventEnum.INTERACTION_REQUEST
    );
  });
}

export function createFinalAssistantFromReconnectReplay({
  activeSession,
  appendMessage,
  messages = [],
  dialogProcessId = "",
} = {}) {
  if (!activeSession?.value) return null;
  const normalizedDpId = _trimStr(dialogProcessId);
  const replayText =
    collectReconnectDeltaText(messages) ||
    String(
      [...(_ensureArray(messages))]
        .reverse()
        .find((envelope) => _trimStr(envelope?.event) === StreamEventEnum.DONE)
        ?.data?.answer || "",
    );
  if (!_trimStr(replayText)) return null;

  const existingAssistantMessage = findAssistantMessageByDialogProcessId(activeSession, normalizedDpId);
  const targetAssistantMessage = existingAssistantMessage ||
    (hasAssistantMessageWithContent(activeSession, replayText)
      ? null
      : appendMessage(RoleEnum.ASSISTANT, replayText));
  if (!targetAssistantMessage) return null;

  const currentContent = String(targetAssistantMessage?.content || "");
  if (!currentContent.trim()) {
    targetAssistantMessage.content = replayText;
  } else if (!currentContent.includes(replayText) && !replayText.includes(currentContent)) {
    targetAssistantMessage.content = `${currentContent}${replayText}`;
  }

  if (normalizedDpId) targetAssistantMessage.dialogProcessId = normalizedDpId;
  const errorEnvelope = [...(_ensureArray(messages))]
    .reverse()
    .find((envelope) => _trimStr(envelope?.event) === StreamEventEnum.ERROR);
  if (errorEnvelope) {
    targetAssistantMessage.error = String(errorEnvelope?.data?.error || "");
  }
  return targetAssistantMessage;
}
