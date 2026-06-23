/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageStableId,
  getMessageTurnId,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowIso } from "../../infra/timeFields";

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function createRemovedIdentitySnapshot(anchorMessage = {}, removedMessages = []) {
  const removedReferences = new Set(removedMessages.filter(Boolean));
  const removedTurnIds = new Set(removedMessages.map(getMessageTurnId).filter(Boolean));
  const removedIds = new Set(removedMessages.map(getMessageStableId).filter(Boolean));
  const removedDialogProcessIds = new Set(removedMessages.map(getMessageDialogProcessId).filter(Boolean));
  const removedTsValues = new Set(
    removedMessages
      .map((message) => message?.ts)
      .filter((value) => value !== undefined && value !== null),
  );
  const anchorId = getMessageStableId(anchorMessage);
  const anchorTurnScopeId = getMessageTurnScopeId(anchorMessage);
  const anchorTurnId = getMessageTurnId(anchorMessage);
  const anchorDialogProcessId = getMessageDialogProcessId(anchorMessage);
  const anchorTs = anchorMessage?.ts;
  if (anchorTurnId) removedTurnIds.add(anchorTurnId);
  if (anchorId) removedIds.add(anchorId);
  if (anchorDialogProcessId) removedDialogProcessIds.add(anchorDialogProcessId);
  if (anchorTs !== undefined && anchorTs !== null) removedTsValues.add(anchorTs);
  return {
    anchorTurnScopeId,
    anchorTurnId,
    anchorId,
    anchorDialogProcessId,
    anchorTs,
    anchorRole: getMessageRole(anchorMessage).toLowerCase(),
    anchorContent: normalizeTrimmedString(anchorMessage?.content),
    removedTurnIds,
    removedReferences,
    removedIds,
    removedDialogProcessIds,
    removedTsValues,
  };
}

function matchesStableRemovedIdentity(message = {}, identity) {
  if (!message || typeof message !== "object") return false;
  if (identity.removedReferences.has(message)) return true;
  const messageTurnId = getMessageTurnId(message);
  if (messageTurnId && identity.removedTurnIds.has(messageTurnId)) return true;
  const messageId = getMessageStableId(message);
  if (messageId && identity.removedIds.has(messageId)) return true;
  const messageTs = message?.ts;
  if (messageTs !== undefined && messageTs !== null && identity.removedTsValues.has(messageTs)) return true;
  const messageDialogProcessId = getMessageDialogProcessId(message);
  return Boolean(messageDialogProcessId && identity.removedDialogProcessIds.has(messageDialogProcessId));
}

function matchesFinalRemovedIdentity(message = {}, identity) {
  if (!message || typeof message !== "object") return false;
  if (identity.removedReferences.has(message)) return true;
  const messageTurnId = getMessageTurnId(message);
  if (messageTurnId && identity.removedTurnIds.has(messageTurnId)) return true;
  const messageId = getMessageStableId(message);
  if (messageId && identity.removedIds.has(messageId)) return true;
  const messageTs = message?.ts;
  // Final session detail may legitimately reuse the old dialogProcessId for the
  // replacement turn, so final reconcile only removes by immutable message
  // identity/reference/timestamp and never by content or dialogProcessId alone.
  return messageTs !== undefined && messageTs !== null && identity.removedTsValues.has(messageTs);
}

function matchesImmediateCompatIdentity(message = {}, identity) {
  if (matchesStableRemovedIdentity(message, identity)) return true;
  // Compatibility-only fallback for the immediate post-delete pass. It handles
  // legacy backend snapshots that do not expose stable ids/turn ids yet. Final
  // reconcile intentionally never uses content matching to avoid deleting a new
  // resend when the edited text duplicates an earlier user message.
  return Boolean(
    identity.anchorRole &&
    identity.anchorContent &&
    getMessageRole(message).toLowerCase() === identity.anchorRole &&
    normalizeTrimmedString(message?.content) === identity.anchorContent,
  );
}

function findAppendedResendStartIndex(sourceMessages = [], operation, identity, matchRemoved) {
  const originalStartIndex = Number(operation?.originalStartIndex);
  if (!Array.isArray(sourceMessages) || originalStartIndex < 0 || sourceMessages.length <= originalStartIndex) {
    return -1;
  }
  for (let index = originalStartIndex; index < sourceMessages.length; index += 1) {
    const message = sourceMessages[index];
    if (isUserMessage(message) && !matchRemoved(message, identity)) {
      return index;
    }
  }
  return -1;
}

export function reconcileStaleResendMessages(session, operation = {}, options = {}) {
  if (!session || !operation || Number(operation.originalStartIndex) < 0) {
    return { changed: false, messagesChanged: false, rawMessagesChanged: false };
  }
  const finalOnly = options.finalOnly === true;
  const identity = createRemovedIdentitySnapshot(operation.anchorMessage, operation.removedMessages || []);
  const immediateMatch = (message) => matchesImmediateCompatIdentity(message, identity);
  const stableMatch = (message) => matchesStableRemovedIdentity(message, identity);
  const finalMatch = (message) => matchesFinalRemovedIdentity(message, identity);

  const pruneMessages = (sourceMessages = []) => {
    const appendedResendStartIndex = findAppendedResendStartIndex(
      sourceMessages,
      operation,
      identity,
      immediateMatch,
    );
    const kept = [];
    let changed = false;
    sourceMessages.forEach((message, index) => {
      const candidateForRemoval = index >= operation.originalStartIndex && (
        appendedResendStartIndex < 0 ||
        index < appendedResendStartIndex ||
        stableMatch(message)
      );
      const shouldRemove = finalOnly
        ? candidateForRemoval && finalMatch(message)
        : candidateForRemoval && immediateMatch(message);
      if (shouldRemove) {
        changed = true;
        return;
      }
      kept.push(message);
    });
    return { kept, changed };
  };

  const messages = Array.isArray(session.messages) ? session.messages : [];
  const messagesResult = pruneMessages(messages);
  if (messagesResult.changed) session.messages = messagesResult.kept;

  let rawMessagesChanged = false;
  if (Array.isArray(session.rawMessages)) {
    const rawMessagesResult = pruneMessages(session.rawMessages);
    if (rawMessagesResult.changed) session.rawMessages = rawMessagesResult.kept;
    rawMessagesChanged = rawMessagesResult.changed;
  }

  return {
    changed: messagesResult.changed || rawMessagesChanged,
    messagesChanged: messagesResult.changed,
    rawMessagesChanged,
  };
}

export function syncSessionMessageSummary(session) {
  if (!session) return;
  const messages = Array.isArray(session.messages) ? session.messages : [];
  session.messageCount = messages.length;
  session.lastMessage = messages.length ? messages[messages.length - 1] : null;
  session.updatedAt = nowIso();
}
