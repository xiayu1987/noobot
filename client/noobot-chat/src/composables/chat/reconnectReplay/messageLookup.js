/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants";
import { _isAssistantRole, _matchesDialogProcessId, _trimStr } from "./utils";

export function findAssistantMessageByDialogProcessId(activeSession, dialogProcessId = "") {
  const normalizedDpId = _trimStr(dialogProcessId);
  if (!normalizedDpId || !activeSession?.value) return null;
  return (activeSession.value.messages || []).find(
    (messageItem) =>
      _isAssistantRole(messageItem) &&
      _matchesDialogProcessId(messageItem, normalizedDpId),
  ) || null;
}

export function hasAssistantMessageWithContent(activeSession, content = "") {
  const normalizedContent = _trimStr(content);
  if (!normalizedContent || !activeSession?.value) return false;
  return (activeSession.value.messages || []).some(
    (messageItem) =>
      _isAssistantRole(messageItem) &&
      _trimStr(messageItem?.content) === normalizedContent,
  );
}

export function mergeRealtimeLogs(targetMessage, newLogs, { maxCount = 10 } = {}) {
  if (!targetMessage || !newLogs?.length) return;
  targetMessage.realtimeLogs = [
    ...(targetMessage.realtimeLogs || []),
    ...newLogs,
  ].slice(-maxCount);
}

export function findLatestAssistantMessageForRealtimeLogs({
  activeSession,
  normalizedDpId = "",
} = {}) {
  const messageList = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  return [...messageList].reverse().find((messageItem) => {
    if (_trimStr(messageItem?.role) !== RoleEnum.ASSISTANT) return false;
    if (!normalizedDpId) return true;
    const itemDpId = _trimStr(messageItem?.dialogProcessId);
    return !itemDpId || itemDpId === normalizedDpId;
  }) || null;
}
