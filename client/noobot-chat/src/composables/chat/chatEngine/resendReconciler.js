/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeTrimmedString } from "./utils";
import {
  getMessageDialogProcessId,
  getMessageRole,
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowIso } from "../../infra/timeFields";

function isUserMessage(message = {}) {
  return getMessageRole(message).toLowerCase() === "user";
}

function createRemovedIdentitySnapshot(anchorMessage = {}, removedMessages = []) {
  const removedReferences = new Set(removedMessages.filter(Boolean));
  const removedTurnScopeIds = new Set(removedMessages.map(getMessageTurnScopeId).filter(Boolean));
  const removedDialogProcessIds = new Set(removedMessages.map(getMessageDialogProcessId).filter(Boolean));
  const removedTsValues = new Set(
    removedMessages
      .map((message) => message?.ts)
      .filter((value) => value !== undefined && value !== null),
  );
  const anchorTurnScopeId = getMessageTurnScopeId(anchorMessage);
  const anchorDialogProcessId = getMessageDialogProcessId(anchorMessage);
  const anchorTs = anchorMessage?.ts;
  if (anchorTurnScopeId) removedTurnScopeIds.add(anchorTurnScopeId);
  if (anchorDialogProcessId) removedDialogProcessIds.add(anchorDialogProcessId);
  if (anchorTs !== undefined && anchorTs !== null) removedTsValues.add(anchorTs);
  return {
    anchorTurnScopeId,
    anchorDialogProcessId,
    anchorTs,
    anchorRole: getMessageRole(anchorMessage).toLowerCase(),
    anchorContent: normalizeTrimmedString(anchorMessage?.content),
    removedReferences,
    removedTurnScopeIds,
    removedDialogProcessIds,
    removedTsValues,
  };
}

function matchesStableRemovedIdentity(message = {}, identity) {
  if (!message || typeof message !== "object") return false;
  if (identity.removedReferences.has(message)) return true;
  const messageTurnScopeId = getMessageTurnScopeId(message);
  if (messageTurnScopeId && identity.removedTurnScopeIds.has(messageTurnScopeId)) return true;
  const messageTs = message?.ts;
  if (messageTs !== undefined && messageTs !== null && identity.removedTsValues.has(messageTs)) return true;
  const messageDialogProcessId = getMessageDialogProcessId(message);
  return Boolean(messageDialogProcessId && identity.removedDialogProcessIds.has(messageDialogProcessId));
}

function matchesFinalRemovedIdentity(message = {}, identity, { allowTurnScope = false } = {}) {
  if (!message || typeof message !== "object") return false;
  if (identity.removedReferences.has(message)) return true;
  const messageTurnScopeId = getMessageTurnScopeId(message);
  if (allowTurnScope && messageTurnScopeId && identity.removedTurnScopeIds.has(messageTurnScopeId)) return true;
  const messageTs = message?.ts;
  // Final session detail may legitimately reuse the old dialogProcessId for the
  // replacement turn, so final reconcile only removes by object reference or
  // timestamp and never by content or dialogProcessId alone.
  return messageTs !== undefined && messageTs !== null && identity.removedTsValues.has(messageTs);
}

function matchesImmediateCompatIdentity(message = {}, identity) {
  if (matchesStableRemovedIdentity(message, identity)) return true;
  // Compatibility-only fallback for the immediate post-delete pass. Final
  // reconcile intentionally never uses content matching to avoid deleting a
  // new resend when the edited text duplicates an earlier user message.
  return Boolean(
    identity.anchorRole &&
    identity.anchorContent &&
    getMessageRole(message).toLowerCase() === identity.anchorRole &&
    normalizeTrimmedString(message?.content) === identity.anchorContent,
  );
}

function normalizeIdSet(values = []) {
  return new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => normalizeTrimmedString(value))
      .filter(Boolean),
  );
}

function collectRefValues(refs = [], key = "") {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => ref?.[key])
    .filter((value) => value !== undefined && value !== null);
}

function mergeReplacementSide(source = {}) {
  const turnScopeIds = normalizeIdSet([
    source?.turnScopeId,
    source?.replacementTurnScopeId,
    ...(Array.isArray(source?.turnScopeIds) ? source.turnScopeIds : []),
    ...collectRefValues(source?.messages, "turnScopeId"),
  ]);
  const dialogProcessIds = normalizeIdSet([
    source?.dialogProcessId,
    source?.replacementDialogProcessId,
    ...(Array.isArray(source?.dialogProcessIds) ? source.dialogProcessIds : []),
    ...collectRefValues(source?.messages, "dialogProcessId"),
    ...collectRefValues(source?.messages, "dialogId"),
  ]);
  return { turnScopeIds, dialogProcessIds };
}

function normalizeExplicitTurnReplacement(operation = {}) {
  const scopeCompact = operation?.turnScopeReplacement && typeof operation.turnScopeReplacement === "object"
    ? operation.turnScopeReplacement
    : null;
  if (!scopeCompact) return null;
  const replaced = mergeReplacementSide({
    turnScopeIds: scopeCompact.replacedTurnScopeIds,
    dialogProcessIds: scopeCompact.replacedDialogProcessIds,
  });
  const replacement = mergeReplacementSide({
    turnScopeId: scopeCompact.replacementTurnScopeId,
    turnScopeIds: scopeCompact.replacementTurnScopeIds,
    dialogProcessId: scopeCompact.replacementDialogProcessId,
    dialogProcessIds: scopeCompact.replacementDialogProcessIds,
  });
  const hasReplaced = replaced.turnScopeIds.size > 0 ||
    replaced.dialogProcessIds.size > 0;
  const hasReplacement = replacement.turnScopeIds.size > 0 ||
    replacement.dialogProcessIds.size > 0;
  return hasReplaced ? { replaced, replacement, hasReplacement } : null;
}

function matchesReplacementSide(message = {}, side = {}) {
  if (!message || typeof message !== "object") return false;
  const turnScopeId = getMessageTurnScopeId(message);
  if (turnScopeId && side.turnScopeIds?.has(turnScopeId)) return true;
  const dialogProcessId = getMessageDialogProcessId(message);
  return Boolean(dialogProcessId && side.dialogProcessIds?.has(dialogProcessId));
}

function pruneByExplicitTurnReplacement(sourceMessages = [], explicitReplacement = null) {
  if (!explicitReplacement || !Array.isArray(sourceMessages)) {
    return { kept: sourceMessages, changed: false };
  }
  const kept = [];
  let changed = false;
  sourceMessages.forEach((message) => {
    const isReplacement = explicitReplacement.hasReplacement
      && matchesReplacementSide(message, explicitReplacement.replacement);
    const isReplaced = matchesReplacementSide(message, explicitReplacement.replaced);
    if (isReplaced && !isReplacement) {
      changed = true;
      return;
    }
    kept.push(message);
  });
  return { kept, changed };
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
  const finalMatch = (message) => matchesFinalRemovedIdentity(message, identity, {
    allowTurnScope: true,
  });
  const explicitReplacement = normalizeExplicitTurnReplacement(operation);

  const pruneMessages = (sourceMessages = []) => {
    if (explicitReplacement) {
      return pruneByExplicitTurnReplacement(sourceMessages, explicitReplacement);
    }
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
        ? finalMatch(message)
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
