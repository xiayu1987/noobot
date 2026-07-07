/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageRuntimeChannelState } from "../../composables/chat/sessionRunStateMachine";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function normalizeMessageRole(messageItem = {}) {
  const explicitRole = normalizeText(
    messageItem?.role ||
      messageItem?.messageRole ||
      messageItem?.message_role ||
      messageItem?.authorRole ||
      messageItem?.author_role ||
      messageItem?.senderRole ||
      messageItem?.sender_role,
  );
  if (explicitRole === "human") return "user";
  if (explicitRole === "ai" || explicitRole === "bot") return "assistant";
  if (explicitRole === "function") return "tool";
  if (explicitRole) return explicitRole;
  if (
    messageItem?.frontendUserMessage === true ||
    messageItem?.additional_kwargs?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.frontendUserMessage === true ||
    messageItem?.lc_kwargs?.additional_kwargs?.frontendUserMessage === true
  ) return "user";
  return "";
}

function normalizeIdentityValue(value = "") { return String(value || "").trim(); }
function getMessagePrimaryId(messageItem = {}) { return normalizeIdentityValue(messageItem?.id || messageItem?.messageId || messageItem?.message_id || messageItem?.clientMessageId || messageItem?.client_message_id); }
function getMessageDialogProcessId(messageItem = {}) { return normalizeIdentityValue(messageItem?.dialogProcessId || messageItem?.dialog_process_id || messageItem?.dialogId || messageItem?.dialog_id || messageItem?.channelState?.dialogProcessId || messageItem?.channelState?.dialog_process_id || messageItem?.channelState?.dialogId || messageItem?.channelState?.dialog_id); }
function getMessageTurnScopeId(messageItem = {}) { return normalizeIdentityValue(messageItem?.turnScopeId || messageItem?.turn_scope_id || messageItem?.channelState?.turnScopeId || messageItem?.channelState?.turn_scope_id); }
function getMessageSessionId(messageItem = {}) { return normalizeIdentityValue(messageItem?.sessionId || messageItem?.session_id || messageItem?.backendSessionId || messageItem?.backend_session_id || messageItem?.channelState?.sessionId || messageItem?.channelState?.session_id || messageItem?.channelState?.backendSessionId || messageItem?.channelState?.backend_session_id); }

export function isSameMessageIdentity(targetMessage = {}, candidateMessage = {}) {
  if (targetMessage === candidateMessage) return true;
  const targetId = getMessagePrimaryId(targetMessage);
  const candidateId = getMessagePrimaryId(candidateMessage);
  if (targetId && candidateId) return targetId === candidateId;
  const targetRole = normalizeMessageRole(targetMessage);
  const candidateRole = normalizeMessageRole(candidateMessage);
  if (targetRole && candidateRole && targetRole !== candidateRole) return false;
  const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
  const candidateDialogProcessId = getMessageDialogProcessId(candidateMessage);
  if (targetDialogProcessId && candidateDialogProcessId) return targetDialogProcessId === candidateDialogProcessId;
  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  const candidateTurnScopeId = getMessageTurnScopeId(candidateMessage);
  if (targetTurnScopeId && candidateTurnScopeId) {
    const targetSessionId = getMessageSessionId(targetMessage);
    const candidateSessionId = getMessageSessionId(candidateMessage);
    return targetTurnScopeId === candidateTurnScopeId && (!targetSessionId || !candidateSessionId || targetSessionId === candidateSessionId);
  }
  return false;
}

function findMessageIdentityIndex(targetMessage = {}, allMessages = []) {
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const directIndex = messages.indexOf(targetMessage);
  if (directIndex >= 0) return directIndex;
  return messages.findIndex((candidateMessage) => isSameMessageIdentity(targetMessage, candidateMessage));
}

const GENERATED_STATUS_LABEL = "已生成";
const STOPPED_STATUS_LABEL = "已停止";
export function isMonotonicMessage(messageItem = {}) {
  if (!messageItem || typeof messageItem !== "object") return false;
  if (messageItem.isMonotonic === true || messageItem.monotonic === true) return true;
  if (normalizeText(messageItem.monotonicState) === "monotonic") return true;
  if (normalizeText(messageItem.stopState) === "stopped") return true;
  const channelState = getMessageRuntimeChannelState(messageItem);
  const state = normalizeText(channelState?.state || messageItem.state || messageItem.status);
  if (["completed", "done", "stopped"].includes(state)) return true;
  const label = normalizeText(messageItem.statusLabel);
  return ["generated", GENERATED_STATUS_LABEL, "stopped", STOPPED_STATUS_LABEL].includes(label);
}

export function isUserMessage(messageItem = {}) { return normalizeMessageRole(messageItem) === "user"; }
function isPlainUserMessage(messageItem = {}) { if (!isUserMessage(messageItem)) return false; const type = normalizeText(messageItem?.type || messageItem?.messageType); return !type || type === "message" || type === "user"; }
function findMessageIndex(targetMessage = {}, allMessages = []) { return findMessageIdentityIndex(targetMessage, allMessages); }

export function resolveMonotonicUserTarget(messageItem = {}, allMessages = []) {
  if (!messageItem || typeof messageItem !== "object") return null;
  if (isUserMessage(messageItem)) return messageItem;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const directIndex = findMessageIndex(messageItem, messages);
  if (directIndex >= 0 && isUserMessage(messages[directIndex])) return messages[directIndex];
  const targetDialogProcessId = getMessageDialogProcessId(messageItem);
  if (targetDialogProcessId) {
    const sameDialogProcessUserMessage = messages.find((item) => isUserMessage(item) && getMessageDialogProcessId(item) === targetDialogProcessId);
    if (sameDialogProcessUserMessage) return sameDialogProcessUserMessage;
  }
  const targetTurnScopeId = getMessageTurnScopeId(messageItem);
  if (targetTurnScopeId) {
    const targetSessionId = getMessageSessionId(messageItem);
    const sameTurnScopeUserMessage = messages.find((item) => isUserMessage(item) && getMessageTurnScopeId(item) === targetTurnScopeId && (!targetSessionId || !getMessageSessionId(item) || targetSessionId === getMessageSessionId(item)));
    if (sameTurnScopeUserMessage) return sameTurnScopeUserMessage;
  }
  if (directIndex >= 0) for (let index = directIndex - 1; index >= 0; index -= 1) if (isUserMessage(messages[index])) return messages[index];
  return null;
}

function attachMonotonicSource(sourceMap, userMessage, sourceMessage) { if (isUserMessage(userMessage) && isMonotonicMessage(sourceMessage) && !sourceMap.has(userMessage)) sourceMap.set(userMessage, sourceMessage); }
function buildMonotonicSourceMap(allMessages = []) {
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const sourceMap = new Map();
  for (const messageItem of messages) if (isUserMessage(messageItem) && isMonotonicMessage(messageItem)) attachMonotonicSource(sourceMap, messageItem, messageItem);
  for (let index = 0; index < messages.length; index += 1) {
    const sourceMessage = messages[index];
    if (isUserMessage(sourceMessage) || !isMonotonicMessage(sourceMessage)) continue;
    const sourceDialogProcessId = getMessageDialogProcessId(sourceMessage);
    if (sourceDialogProcessId) {
      const sameDialogProcessUserMessage = messages.find((item) => isUserMessage(item) && getMessageDialogProcessId(item) === sourceDialogProcessId);
      if (sameDialogProcessUserMessage) { attachMonotonicSource(sourceMap, sameDialogProcessUserMessage, sourceMessage); continue; }
    }
    const sourceTurnScopeId = getMessageTurnScopeId(sourceMessage);
    if (sourceTurnScopeId) {
      const sourceSessionId = getMessageSessionId(sourceMessage);
      const sameTurnScopeUserMessage = messages.find((item) => isUserMessage(item) && getMessageTurnScopeId(item) === sourceTurnScopeId && (!sourceSessionId || !getMessageSessionId(item) || sourceSessionId === getMessageSessionId(item)));
      if (sameTurnScopeUserMessage) { attachMonotonicSource(sourceMap, sameTurnScopeUserMessage, sourceMessage); continue; }
    }
    for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1) if (isUserMessage(messages[prevIndex])) { attachMonotonicSource(sourceMap, messages[prevIndex], sourceMessage); break; }
  }
  return sourceMap;
}

function getMonotonicSourceForUser(userMessage = {}, allMessages = []) {
  if (!isUserMessage(userMessage)) return null;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) return isMonotonicMessage(userMessage) ? userMessage : null;
  const sourceMap = buildMonotonicSourceMap(messages);
  const directSource = sourceMap.get(userMessage);
  if (directSource) return directSource;
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex >= 0) return sourceMap.get(messages[userIndex]) || null;
  for (const [mappedUser, sourceMessage] of sourceMap.entries()) if (isSameMessageIdentity(mappedUser, userMessage)) return sourceMessage;
  return null;
}

function isTailOrphanUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage) || isMonotonicMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) return true;
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;
  const userDialogProcessId = getMessageDialogProcessId(userMessage);
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const nextMessage = messages[index];
    if (userDialogProcessId && getMessageDialogProcessId(nextMessage) !== userDialogProcessId) continue;
    return false;
  }
  return true;
}

function isLatestUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;
  for (let index = userIndex + 1; index < messages.length; index += 1) if (isPlainUserMessage(messages[index])) return false;
  return true;
}

export function resolveMonotonicMessageActionProps(context = {}) {
  const messageItem = context?.messageItem && typeof context.messageItem === "object" ? context.messageItem : {};
  const allMessages = Array.isArray(context?.allMessages) ? context.allMessages : [];
  const monotonicUserTarget = resolveMonotonicUserTarget(messageItem, allMessages);
  const canDelete = typeof context?.deleteMonotonicMessage === "function";
  const canResend = typeof context?.resendMonotonicMessage === "function";
  const monotonicSource = getMonotonicSourceForUser(messageItem, allMessages);
  const tailOrphanUserMessage = isTailOrphanUserMessage(messageItem, allMessages);
  const latestUserMessage = isLatestUserMessage(messageItem, allMessages);
  const shouldMountOnCurrentUser = isUserMessage(messageItem) && Boolean(monotonicUserTarget) && isSameMessageIdentity(messageItem, monotonicUserTarget) && latestUserMessage && (Boolean(monotonicSource) || tailOrphanUserMessage);
  return {
    visible: shouldMountOnCurrentUser && (canDelete || canResend),
    disabled: context?.sending === true,
    messageItem: monotonicUserTarget || messageItem,
    onDelete: canDelete ? context.deleteMonotonicMessage : null,
    onResend: canResend ? context.resendMonotonicMessage : null,
    translate: typeof context?.translate === "function" ? context.translate : (key = "") => key,
  };
}
