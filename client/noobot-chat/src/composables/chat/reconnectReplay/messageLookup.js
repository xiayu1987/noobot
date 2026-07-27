/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { RoleEnum } from "../../../shared/constants/chatConstants.js";
import { _isAssistantRole, _matchesDialogProcessId, _trimStr } from "./utils.js";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity.js";

export function findAssistantMessageByDialogProcessId(activeSession, dialogProcessId = "") {
  const normalizedDpId = _trimStr(dialogProcessId);
  if (!normalizedDpId || !activeSession?.value) return null;
  return (activeSession.value.messages || []).find(
    (messageItem) =>
      _isAssistantRole(messageItem) &&
      _matchesDialogProcessId(messageItem, normalizedDpId),
  ) || null;
}

export function findAssistantMessageByTurnScopeId(activeSession, turnScopeId = "") {
  const normalizedTurnScopeId = _trimStr(turnScopeId);
  if (!normalizedTurnScopeId || !activeSession?.value) return null;
  return (activeSession.value.messages || []).find(
    (messageItem) =>
      _isAssistantRole(messageItem) &&
      getMessageTurnScopeId(messageItem) === normalizedTurnScopeId,
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

export function findLatestAssistantMessageForRealtimeLogs({
  activeSession,
  normalizedDpId = "",
} = {}) {
  const messageList = Array.isArray(activeSession?.value?.messages)
    ? activeSession.value.messages
    : [];
  return [...messageList].reverse().find((messageItem) => {
    if (getMessageRole(messageItem) !== RoleEnum.ASSISTANT) return false;
    if (!normalizedDpId) return true;
    const itemDpId = getMessageDialogProcessId(messageItem);
    return !itemDpId || itemDpId === normalizedDpId;
  }) || null;
}
