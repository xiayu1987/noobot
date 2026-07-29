/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../model/chatConstants.js";
import {
  findReusableMessageObject,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
} from "../../model/reconnectReplayModel.js";
import { _ensureArray, _isAssistantRole, _trimStr } from "./utils.js";
import {
  findAssistantMessageByDialogProcessId,
  hasAssistantMessageWithContent,
} from "./messageLookup.js";

export {
  renderActiveSessionBeforeReplay,
} from "./hydrationReplay.js";
export {
  applyReconnectReplayBatchToActiveSession,
  applyReconnectEnvelopeBatchToTargetMessage,
  applyReconnectEnvelopeToTargetMessage,
  buildReconnectReplayEnvelopeCallbacks,
  finalizeReconnectReplayBatch,
  prepareReconnectReplayBatchPlan,
  prepareReconnectReplayMessages,
  shouldSkipReconnectBatchAfterTerminal,
} from "./batchReplay.js";
export {
  findAssistantMessageByDialogProcessId,
  findAssistantMessageByTurnScopeId,
  findLatestAssistantMessageForRealtimeLogs,
  hasAssistantMessageWithContent,
} from "./messageLookup.js";
export function applyAssistantFailureState({ targetAssistantMessage, errorMessage = "", translate } = {}) {
  if (!targetAssistantMessage) return;
  targetAssistantMessage.error = _trimStr(errorMessage);
  if (!_trimStr(targetAssistantMessage.content)) {
    targetAssistantMessage.content = `> ${translate("chat.occurredError", {
      error: targetAssistantMessage.error || translate("chat.unknownError"),
    })}`;
  }
}

export function mergeAssistantAttachments({
  targetAssistantMessage,
  attachments = [],
  makeViewMessage,
  mergeAttachments,
} = {}) {
  if (!targetAssistantMessage || !Array.isArray(attachments) || !attachments.length) {
    return;
  }
  const normalizedAttachments =
    makeViewMessage({ attachments })?.attachments || attachments;
  targetAssistantMessage.attachments = mergeAttachments(
    _ensureArray(targetAssistantMessage.attachments),
    normalizedAttachments,
  );
}

export function applyFoldedMessagesToActiveSession(activeSession, foldedMessages = []) {
  if (!activeSession?.value) return [];
  const existingMessages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  const nextMessages = mergeCurrentUserMessagesIntoFoldedMessages({
    foldedMessages,
    existingMessages,
  }).map((nextMessage) => {
    const reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
    return reusableMessage
      ? patchMessageObjectPreservingUiState(
        reusableMessage,
        nextMessage,
      )
      : nextMessage;
  });
  if (activeSession.value.messages !== existingMessages) {
    activeSession.value.messages = existingMessages;
  }
  existingMessages.splice(0, existingMessages.length, ...nextMessages);
  return existingMessages;
}

export function applyFoldedMessagesForDialogProcess(activeSession, foldedMessages = [], dialogProcessId = "") {
  if (!activeSession?.value) return [];
  const normalizedDpId = _trimStr(dialogProcessId);
  if (!normalizedDpId) return applyFoldedMessagesToActiveSession(activeSession, foldedMessages);
  const existingMessages = Array.isArray(activeSession.value.messages)
    ? activeSession.value.messages
    : [];
  const assistantMessagesForDialogProcess = (_ensureArray(foldedMessages))
    .filter(
      (messageItem) =>
        _isAssistantRole(messageItem) &&
        _trimStr(messageItem?.dialogProcessId) === normalizedDpId,
    );
  if (!assistantMessagesForDialogProcess.length) return existingMessages;

  for (const nextMessage of assistantMessagesForDialogProcess) {
    const nextMessageId = _trimStr(nextMessage?.messageId || nextMessage?.id);
    if (!nextMessageId) continue;
    const reusableMessage = existingMessages.find(
      (messageItem) =>
        _isAssistantRole(messageItem) &&
        _trimStr(messageItem?.messageId || messageItem?.id) === nextMessageId,
    );
    if (!reusableMessage) continue;
    patchMessageObjectPreservingUiState(
      reusableMessage,
      nextMessage,
    );
  }
  return existingMessages;
}
