/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { StreamEventEnum } from "../../../shared/constants/chatConstants";
import {
  findLatestPendingAssistantAfterLastUser,
  findReusableMessageObject,
  mergeCurrentUserMessagesIntoFoldedMessages,
  patchMessageObjectPreservingUiState,
} from "../../infra/reconnectReplayModel";
import { _ensureArray, _isAssistantRole, _matchesDialogProcessId, _trimStr } from "./utils";
import {
  findAssistantMessageByDialogProcessId,
  hasAssistantMessageWithContent,
} from "./messageLookup";

export {
  hydrateSessionBeforeReconnectReplayIfNeeded,
  renderActiveSessionBeforeReplay,
  shouldHydrateSessionBeforeReplay,
} from "./hydrationReplay";
export {
  applyReconnectReplayBatchToActiveSession,
  applyDoneSnapshotReconnectBatch,
  applyReconnectEnvelopeBatchToTargetMessage,
  applyReconnectEnvelopeToTargetMessage,
  applyReconnectFallbackAssistant,
  buildReconnectReplayEnvelopeCallbacks,
  finalizeReconnectReplayBatch,
  prepareReconnectReplayBatchPlan,
  prepareReconnectReplayMessages,
  resolveReconnectTargetOrApplyFallbackAssistant,
  shouldSkipReconnectBatchAfterTerminal,
} from "./batchReplay";
export {
  findAssistantMessageByDialogProcessId,
  findLatestAssistantMessageForRealtimeLogs,
  hasAssistantMessageWithContent,
  mergeRealtimeLogs,
} from "./messageLookup";
export {
  createFinalAssistantFromReconnectReplay,
  hasReconnectInFlightEvent,
  resolveReconnectTargetAssistantMessage,
} from "./assistantMessageReplay";
export {
  applyDoneMessagesFromReconnect,
  applyDoneRealtimeLogsFromReconnectBatch,
} from "./doneReplay";

export function applyAssistantFailureState({ targetAssistantMessage, errorMessage = "", translate } = {}) {
  if (!targetAssistantMessage) return;
  targetAssistantMessage.pending = false;
  targetAssistantMessage.statusLabel = translate("chat.failed");
  targetAssistantMessage.error = _trimStr(errorMessage);
  if (!_trimStr(targetAssistantMessage.content)) {
    targetAssistantMessage.content = `> ${translate("chat.occurredError", {
      error: targetAssistantMessage.error || translate("chat.unknownError"),
    })}`;
  }
}

export function mergeAssistantAttachmentMetas({
  targetAssistantMessage,
  attachmentMetas = [],
  makeViewMessage,
  mergeAttachmentMetas,
} = {}) {
  if (!targetAssistantMessage || !Array.isArray(attachmentMetas) || !attachmentMetas.length) {
    return;
  }
  const normalizedAttachmentMetas =
    makeViewMessage({ attachmentMetas })?.attachmentMetas || attachmentMetas;
  targetAssistantMessage.attachmentMetas = mergeAttachmentMetas(
    _ensureArray(targetAssistantMessage.attachmentMetas),
    normalizedAttachmentMetas,
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
      ? patchMessageObjectPreservingUiState(reusableMessage, nextMessage)
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
        _matchesDialogProcessId(messageItem, normalizedDpId),
    );
  if (!assistantMessagesForDialogProcess.length) return existingMessages;

  for (const nextMessage of assistantMessagesForDialogProcess) {
    let reusableMessage = findReusableMessageObject(nextMessage, existingMessages);
    if (!reusableMessage) {
      reusableMessage = findLatestPendingAssistantAfterLastUser(existingMessages);
      if (reusableMessage && _trimStr(reusableMessage?.dialogProcessId)) {
        reusableMessage = null;
      }
    }
    if (reusableMessage) {
      reusableMessage.dialogProcessId = normalizedDpId;
      patchMessageObjectPreservingUiState(reusableMessage, nextMessage);
      continue;
    }
    existingMessages.push(nextMessage);
  }
  return existingMessages;
}

