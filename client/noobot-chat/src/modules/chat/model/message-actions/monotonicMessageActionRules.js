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
import {
  areTurnScopeIdsEquivalent,
  findMessageIdentityIndex,
  getMessageRole,
  getMessageTurnScopeId,
  isSameMessageIdentity,
} from "../messageIdentity.js";
import { text, isFunction, isObjectLike } from "@noobot/shared/value";
function normalizeText(value = "") {
  return text(value).toLowerCase();
}

function findTurnUserMessage(turnScopeId, messages) {
  if (!turnScopeId) return null;
  return (
    messages.find(
      (item) =>
        isUserMessage(item) && areTurnScopeIdsEquivalent(getMessageTurnScopeId(item), turnScopeId),
    ) || null
  );
}

export function isUserMessage(messageItem = {}) {
  return getMessageRole(messageItem) === "user";
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
export function resolveMonotonicUserTarget(messageItem = {}, allMessages = []) {
  if (!isObjectLike(messageItem)) return null;
  if (isUserMessage(messageItem)) return messageItem;
  return findTurnUserMessage(getMessageTurnScopeId(messageItem), allMessages);
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
  for (const sourceMessage of messages) {
    if (isUserMessage(sourceMessage) || !isMonotonicSource(sourceMessage)) continue;
    const userMessage = findTurnUserMessage(getMessageTurnScopeId(sourceMessage), messages);
    if (userMessage) attachTerminalSource(sourceMap, userMessage, sourceMessage);
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
  const userIndex = findMessageIdentityIndex(userMessage, messages);
  return userIndex >= 0 ? sourceMap.get(messages[userIndex]) || null : null;
}

function isTailOrphanUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage) || isMonotonicSource(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  if (!messages.length) return true;
  const userIndex = findMessageIdentityIndex(userMessage, messages);
  if (userIndex < 0) return false;
  const userTurnScopeId = getMessageTurnScopeId(userMessage);
  return !messages
    .slice(userIndex + 1)
    .some(
      (nextMessage) =>
        !userTurnScopeId ||
        areTurnScopeIdsEquivalent(getMessageTurnScopeId(nextMessage), userTurnScopeId),
    );
}

function isLatestUserMessage(userMessage = {}, allMessages = []) {
  if (!isPlainUserMessage(userMessage)) return false;
  const messages = Array.isArray(allMessages) ? allMessages : [];
  const userIndex = findMessageIdentityIndex(userMessage, messages);
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
