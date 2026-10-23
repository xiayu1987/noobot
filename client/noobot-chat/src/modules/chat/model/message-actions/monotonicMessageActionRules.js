/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageRuntimeChannelState,
  isTerminalOutcome,
  isTerminalRunState,
  isTurnTerminalNotice,
} from "../../runtime/sessionRunStateMachine.js";
import { areTurnScopeIdsEquivalent } from "../messageIdentity.js";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";
function normalizeText(value = "") {
  return text(value).toLowerCase();
}

function normalizeMessageRole(messageItem = {}) {
  const explicitRole = normalizeText(messageItem?.role);
  if (explicitRole === "human") return "user";
  if (explicitRole === "ai" || explicitRole === "bot") return "assistant";
  if (explicitRole === "function") return "tool";
  if (explicitRole) return explicitRole;
  if (text(messageItem?.messageOrigin).toLowerCase() === "natural") return "user";
  return "";
}

function normalizeIdentityValue(value = "") {
  return text(value);
}
function firstIdentityValue(...values) {
  for (const value of values) if (value) return value;
  return "";
}
function getMessagePrimaryId(messageItem = {}) {
  return normalizeIdentityValue(messageItem?.messageId);
}
function getMessageDialogProcessId(messageItem = {}) {
  return normalizeIdentityValue(
    firstIdentityValue(messageItem?.dialogProcessId, messageItem?.channelState?.dialogProcessId),
  );
}
function getMessageTurnScopeId(messageItem = {}) {
  return normalizeIdentityValue(messageItem?.turnScopeId || messageItem?.channelState?.turnScopeId);
}
function getMessageSessionId(messageItem = {}) {
  return normalizeIdentityValue(
    firstIdentityValue(messageItem?.sessionId, messageItem?.channelState?.sessionId),
  );
}
function sameTurnScope(left = "", right = "") {
  return Boolean(left && right) && areTurnScopeIdsEquivalent(left, right);
}

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
  if (targetDialogProcessId && candidateDialogProcessId)
    return targetDialogProcessId === candidateDialogProcessId;
  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  const candidateTurnScopeId = getMessageTurnScopeId(candidateMessage);
  if (targetTurnScopeId && candidateTurnScopeId) {
    const targetSessionId = getMessageSessionId(targetMessage);
    const candidateSessionId = getMessageSessionId(candidateMessage);
    return (
      sameTurnScope(targetTurnScopeId, candidateTurnScopeId) &&
      (!targetSessionId || !candidateSessionId || targetSessionId === candidateSessionId)
    );
  }
  return false;
}

function findMessageIdentityIndex(targetMessage = {}, allMessages = []) {
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const directIndex = messages.indexOf(targetMessage);
  if (directIndex >= 0) return directIndex;
  return messages.findIndex((candidateMessage) =>
    isSameMessageIdentity(targetMessage, candidateMessage),
  );
}

export function isUserMessage(messageItem = {}) {
  return normalizeMessageRole(messageItem) === "user";
}
export function isMonotonicMessage(messageItem = {}) {
  if (!isObjectLike(messageItem)) return false;
  if (messageItem.isMonotonic === true || messageItem.monotonic === true) return true;
  if (normalizeText(messageItem.monotonicState) === "monotonic") return true;
  if (normalizeText(messageItem.stopState) === "user_stopped") return true;
  const channelState = getMessageRuntimeChannelState(messageItem);
  const state = normalizeText(channelState.state);
  return isTerminalRunState(state) || isTerminalOutcome(messageItem.terminalOutcome);
}
function isPlainUserMessage(messageItem = {}) {
  if (!isUserMessage(messageItem)) return false;
  const type = normalizeText(messageItem?.type || messageItem?.messageType);
  return !type || type === "message" || type === "user";
}
function findMessageIndex(targetMessage = {}, allMessages = []) {
  return findMessageIdentityIndex(targetMessage, allMessages);
}

export function resolveMonotonicUserTarget(messageItem = {}, allMessages = []) {
  if (!isObjectLike(messageItem)) return null;
  if (isUserMessage(messageItem)) return messageItem;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const directIndex = findMessageIndex(messageItem, messages);
  if (directIndex >= 0 && isUserMessage(messages[directIndex])) return messages[directIndex];
  const targetDialogProcessId = getMessageDialogProcessId(messageItem);
  if (targetDialogProcessId) {
    const sameDialogProcessUserMessage = messages.find(
      (item) => isUserMessage(item) && getMessageDialogProcessId(item) === targetDialogProcessId,
    );
    if (sameDialogProcessUserMessage) return sameDialogProcessUserMessage;
  }
  const targetTurnScopeId = getMessageTurnScopeId(messageItem);
  if (targetTurnScopeId) {
    const targetSessionId = getMessageSessionId(messageItem);
    const sameTurnScopeUserMessage = messages.find(
      (item) =>
        isUserMessage(item) &&
        sameTurnScope(getMessageTurnScopeId(item), targetTurnScopeId) &&
        (!targetSessionId ||
          !getMessageSessionId(item) ||
          targetSessionId === getMessageSessionId(item)),
    );
    if (sameTurnScopeUserMessage) return sameTurnScopeUserMessage;
  }
  if (directIndex >= 0)
    for (let index = directIndex - 1; index >= 0; index -= 1)
      if (isUserMessage(messages[index])) return messages[index];
  return null;
}

function isTerminalTurnStatusPlaceholder(messageItem = {}) {
  const status = normalizeText(messageItem?.turnStatus?.status);
  return messageItem?.turnStatusPlaceholder === true && isTurnTerminalNotice(status);
}

function isMonotonicSource(messageItem = {}) {
  return isTerminalTurnStatusPlaceholder(messageItem) || isMonotonicMessage(messageItem);
}

function hasAuthoritativeTerminalFact(messageItem = {}, context = {}) {
  const runtimeState = context?.messageRuntime?.state;
  return Boolean(getMessageTurnScopeId(messageItem)) && isTerminalRunState(runtimeState);
}

function attachTerminalSource(sourceMap, userMessage, sourceMessage) {
  if (isUserMessage(userMessage) && isMonotonicSource(sourceMessage) && !sourceMap.has(userMessage))
    sourceMap.set(userMessage, sourceMessage);
}
function buildTerminalSourceMap(allMessages = [], context = {}) {
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const sourceMap = new Map();
  for (const messageItem of messages) {
    if (
      isUserMessage(messageItem) &&
      (isMonotonicSource(messageItem) || hasAuthoritativeTerminalFact(messageItem, context))
    ) {
      sourceMap.set(messageItem, messageItem);
    }
  }
  for (let index = 0; index < messages.length; index += 1) {
    const sourceMessage = messages[index];
    if (isUserMessage(sourceMessage) || !isMonotonicSource(sourceMessage)) continue;
    const sourceDialogProcessId = getMessageDialogProcessId(sourceMessage);
    if (sourceDialogProcessId) {
      const sameDialogProcessUserMessage = messages.find(
        (item) => isUserMessage(item) && getMessageDialogProcessId(item) === sourceDialogProcessId,
      );
      if (sameDialogProcessUserMessage) {
        attachTerminalSource(sourceMap, sameDialogProcessUserMessage, sourceMessage);
        continue;
      }
    }
    const sourceTurnScopeId = getMessageTurnScopeId(sourceMessage);
    if (sourceTurnScopeId) {
      const sourceSessionId = getMessageSessionId(sourceMessage);
      const sameTurnScopeUserMessage = messages.find(
        (item) =>
          isUserMessage(item) &&
          sameTurnScope(getMessageTurnScopeId(item), sourceTurnScopeId) &&
          (!sourceSessionId ||
            !getMessageSessionId(item) ||
            sourceSessionId === getMessageSessionId(item)),
      );
      if (sameTurnScopeUserMessage) {
        attachTerminalSource(sourceMap, sameTurnScopeUserMessage, sourceMessage);
        continue;
      }
    }
    for (let prevIndex = index - 1; prevIndex >= 0; prevIndex -= 1)
      if (isUserMessage(messages[prevIndex])) {
        attachTerminalSource(sourceMap, messages[prevIndex], sourceMessage);
        break;
      }
  }
  return sourceMap;
}

function getMonotonicSourceForUser(userMessage = {}, allMessages = [], context = {}) {
  if (!isUserMessage(userMessage)) return null;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length)
    return isMonotonicSource(userMessage) || hasAuthoritativeTerminalFact(userMessage, context)
      ? userMessage
      : null;
  const sourceMap = buildTerminalSourceMap(messages, context);
  const directSource = sourceMap.get(userMessage);
  if (directSource) return directSource;
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex >= 0) return sourceMap.get(messages[userIndex]) || null;
  for (const [mappedUser, sourceMessage] of sourceMap.entries())
    if (isSameMessageIdentity(mappedUser, userMessage)) return sourceMessage;
  return null;
}

function isTailOrphanUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage) || isMonotonicSource(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) return true;
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;
  const userDialogProcessId = getMessageDialogProcessId(userMessage);
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const nextMessage = messages[index];
    if (userDialogProcessId && getMessageDialogProcessId(nextMessage) !== userDialogProcessId)
      continue;
    return false;
  }
  return true;
}

function isLatestUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const userIndex = findMessageIndex(userMessage, messages);
  if (userIndex < 0) return false;
  for (let index = userIndex + 1; index < messages.length; index += 1)
    if (isPlainUserMessage(messages[index])) return false;
  return true;
}

export function resolveMonotonicMessageActionProps(context = {}) {
  const messageItem =
    context?.messageItem && typeof context.messageItem === "object" ? context.messageItem : {};
  const allMessages = Array.isArray(context?.allMessages) ? context.allMessages : [];
  const monotonicUserTarget = resolveMonotonicUserTarget(messageItem, allMessages);
  const canDelete = isFunction(context?.deleteMonotonicMessage);
  const canResend = isFunction(context?.resendMonotonicMessage);
  const monotonicSource = getMonotonicSourceForUser(messageItem, allMessages, context);
  const tailOrphanUserMessage = isTailOrphanUserMessage(messageItem, allMessages);
  const latestUserMessage = isLatestUserMessage(messageItem, allMessages);
  const shouldMountOnCurrentUser =
    isUserMessage(messageItem) &&
    Boolean(monotonicUserTarget) &&
    isSameMessageIdentity(messageItem, monotonicUserTarget) &&
    latestUserMessage &&
    (Boolean(monotonicSource) || tailOrphanUserMessage);
  return {
    visible: shouldMountOnCurrentUser && (canDelete || canResend),
    disabled: context?.sending === true,
    messageItem: monotonicUserTarget || messageItem,
    onDelete: canDelete ? context.deleteMonotonicMessage : null,
    onResend: canResend ? context.resendMonotonicMessage : null,
    translate: typeof context?.translate === "function" ? context.translate : (key = "") => key,
  };
}
