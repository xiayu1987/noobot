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
import { _ensureArray, _isAssistantRole, _matchesDialogProcessId, _trimStr, normalizeReplayError } from "./utils";
import {
  findAssistantMessageByDialogProcessId,
  hasAssistantMessageWithContent,
} from "./messageLookup";
import { logReconnectTimingDebug } from "../debug/reconnectTimingDebugLogger";
import { logThinkingReplayDebug } from "../debug/thinkingReplayDebugLogger";
import {
  createTurnPlaceholderMessage,
  findTurnPlaceholderMessage,
} from "../chatEngine/turnPlaceholder";

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
  const sessionId = _trimStr(activeSession.value?.backendSessionId || activeSession.value?.id);
  const logResolution = (resolution, message = null, extra = {}) => {
    logThinkingReplayDebug("frontend.thinkingReplay.reconnectTargetResolved", {
      sessionId,
      dialogProcessId: normalizedDpId,
      turnScopeId: normalizedTurnScopeId,
      resolution,
      messageFound: Boolean(message),
      messagePending: message ? message.pending === true : null,
      messageDialogProcessId: _trimStr(message?.dialogProcessId),
      messageTurnScopeId: _trimStr(message?.turnScopeId),
      messageCount: messageList.length,
      allowCreate: Boolean(allowCreate),
      ...extra,
    });
  };
  const matchedPlaceholder = findTurnPlaceholderMessage(messageList, {
    turnScopeId: normalizedTurnScopeId,
    dialogProcessId: normalizedDpId,
  });
  if (matchedPlaceholder) {
    if (normalizedDpId && !matchedPlaceholder.dialogProcessId) matchedPlaceholder.dialogProcessId = normalizedDpId;
    if (normalizedTurnScopeId && !matchedPlaceholder.turnScopeId) matchedPlaceholder.turnScopeId = normalizedTurnScopeId;
    logResolution("placeholder-match", matchedPlaceholder, {
      accepted: matchedPlaceholder.pending === true,
    });
    return matchedPlaceholder.pending ? matchedPlaceholder : null;
  }
  if (normalizedTurnScopeId) {
    const matchedTurnAssistant = messageList.find(
      (messageItem) =>
        _isAssistantRole(messageItem) &&
        _trimStr(messageItem?.turnScopeId) === normalizedTurnScopeId,
    );
    if (matchedTurnAssistant) {
      if (normalizedDpId && !matchedTurnAssistant.dialogProcessId) {
        matchedTurnAssistant.dialogProcessId = normalizedDpId;
      }
      logResolution("turn-scope-match", matchedTurnAssistant, { accepted: true });
      return matchedTurnAssistant;
    }
    // A scoped authoritative event must never fall back to another turn that
    // happens to reuse the same dialog process (stop -> continue).
    logResolution("turn-scope-missing", null, { accepted: false });
    if (!allowCreate) return null;
    const appendedMessage = createTurnPlaceholderMessage({
      appendMessage,
      sessionId: activeSession.value?.backendSessionId || activeSession.value?.id,
      dialogProcessId: normalizedDpId,
      turnScopeId: normalizedTurnScopeId,
    });
    logResolution("turn-scope-placeholder-created", appendedMessage, {
      accepted: Boolean(appendedMessage),
    });
    return appendedMessage;
  }
  // Reconnect payloads restored from cache may not carry turnScopeId. In that
  // case, keep dialogProcessId as the stable identity and reuse the existing
  // assistant message instead of creating a second, scope-less placeholder.
  // Prefer a pending target below, but also allow a non-pending message here:
  // the caller replays only events newer than lastAppliedSeq and terminal
  // handling is responsible for closing the message.
  const matchedAssistantMessage = messageList.find(
    (messageItem) =>
      normalizedDpId &&
      _isAssistantRole(messageItem) &&
      messageItem?.pending === true &&
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
    logResolution("dialog-process-match", matchedAssistantMessage, {
      accepted: true,
    });
    return matchedAssistantMessage;
  }

  const latestPendingAssistant = findLatestPendingAssistantAfterLastUser(messageList);
  if (latestPendingAssistant) {
    const latestPendingDpId = _trimStr(latestPendingAssistant?.dialogProcessId);
    if (normalizedDpId && latestPendingDpId && latestPendingDpId !== normalizedDpId) {
      logResolution("latest-pending-dialog-mismatch", latestPendingAssistant, {
        accepted: false,
        latestPendingDialogProcessId: latestPendingDpId,
      });
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
    logResolution("latest-pending-match", latestPendingAssistant, { accepted: true });
    return latestPendingAssistant;
  }
  if (!allowCreate) {
    logResolution("no-match-create-disabled", null, { accepted: false });
    return null;
  }
  const appendedMessage = createTurnPlaceholderMessage({
    appendMessage,
    sessionId: activeSession.value?.backendSessionId || activeSession.value?.id,
    dialogProcessId: normalizedDpId,
    turnScopeId: normalizedTurnScopeId,
  });
  logReconnectTimingDebug("frontend.reconnectTiming.assistantResolved", {
    dialogProcessId: normalizedDpId,
    inputTurnScopeId: normalizedTurnScopeId,
    messageTurnScopeId: _trimStr(appendedMessage.turnScopeId),
    resolution: "created",
  });
  logResolution("created", appendedMessage, { accepted: Boolean(appendedMessage) });
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
    targetAssistantMessage.error = normalizeReplayError(errorEnvelope?.data?.error);
  }
  return targetAssistantMessage;
}
