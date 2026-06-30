/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageTurnScopeId,
} from "../../infra/messageIdentity";
import { nowIso } from "../../infra/timeFields";

function createRemovedIdentitySnapshot(anchorMessage = {}, removedMessages = []) {
  const removedReferences = new Set(removedMessages.filter(Boolean));
  const removedTurnScopeIds = new Set(removedMessages.map(getMessageTurnScopeId).filter(Boolean));
  const anchorTurnScopeId = getMessageTurnScopeId(anchorMessage);
  if (anchorTurnScopeId) removedTurnScopeIds.add(anchorTurnScopeId);
  return {
    anchorTurnScopeId,
    removedReferences,
    removedTurnScopeIds,
  };
}

function matchesRemovedTurnScope(message = {}, identity) {
  if (!message || typeof message !== "object") return false;
  if (identity.removedReferences.has(message)) return true;
  const messageTurnScopeId = getMessageTurnScopeId(message);
  return Boolean(messageTurnScopeId && identity.removedTurnScopeIds.has(messageTurnScopeId));
}

function normalizeTurnScopeIdSet(values = []) {
  return new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function collectRefValues(refs = [], key = "") {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => ref?.[key])
    .filter((value) => value !== undefined && value !== null);
}

function mergeReplacementTurnScopeIds(source = {}) {
  return normalizeTurnScopeIdSet([
    source?.turnScopeId,
    source?.replacementTurnScopeId,
    ...(Array.isArray(source?.turnScopeIds) ? source.turnScopeIds : []),
    ...collectRefValues(source?.messages, "turnScopeId"),
  ]);
}

function normalizeExplicitTurnReplacement(operation = {}) {
  const scopeCompact = operation?.turnScopeReplacement && typeof operation.turnScopeReplacement === "object"
    ? operation.turnScopeReplacement
    : null;
  if (!scopeCompact) return null;
  const replacedTurnScopeIds = mergeReplacementTurnScopeIds({
    turnScopeIds: scopeCompact.replacedTurnScopeIds,
  });
  const replacementTurnScopeIds = mergeReplacementTurnScopeIds({
    turnScopeId: scopeCompact.replacementTurnScopeId,
    turnScopeIds: scopeCompact.replacementTurnScopeIds,
  });
  const hasReplaced = replacedTurnScopeIds.size > 0;
  const hasReplacement = replacementTurnScopeIds.size > 0;
  return hasReplaced ? { replacedTurnScopeIds, replacementTurnScopeIds, hasReplacement } : null;
}

function matchesTurnScopeIdSet(message = {}, turnScopeIds = new Set()) {
  if (!message || typeof message !== "object") return false;
  const turnScopeId = getMessageTurnScopeId(message);
  return Boolean(turnScopeId && turnScopeIds.has(turnScopeId));
}

function pruneByExplicitTurnReplacement(sourceMessages = [], explicitReplacement = null) {
  if (!explicitReplacement || !Array.isArray(sourceMessages)) {
    return { kept: sourceMessages, changed: false };
  }
  const kept = [];
  let changed = false;
  sourceMessages.forEach((message) => {
    const isReplacement = explicitReplacement.hasReplacement
      && matchesTurnScopeIdSet(message, explicitReplacement.replacementTurnScopeIds);
    const isReplaced = matchesTurnScopeIdSet(message, explicitReplacement.replacedTurnScopeIds);
    if (isReplaced && !isReplacement) {
      changed = true;
      return;
    }
    kept.push(message);
  });
  return { kept, changed };
}

export function reconcileStaleResendMessages(session, operation = {}, options = {}) {
  if (!session || !operation || Number(operation.originalStartIndex) < 0) {
    return { changed: false, messagesChanged: false, rawMessagesChanged: false };
  }
  const identity = createRemovedIdentitySnapshot(operation.anchorMessage, operation.removedMessages || []);
  const explicitReplacement = normalizeExplicitTurnReplacement(operation);

  const pruneMessages = (sourceMessages = []) => {
    if (explicitReplacement) {
      return pruneByExplicitTurnReplacement(sourceMessages, explicitReplacement);
    }
    const kept = [];
    let changed = false;
    sourceMessages.forEach((message) => {
      const shouldRemove = matchesRemovedTurnScope(message, identity);
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
