/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import { text } from "@noobot/shared/value";
import { createMessageEventState } from "../model/messageEventState.js";

export function summarizeSubSessionMessage(message = {}) {
  return {
    messageUid: text(message?.messageUid),
    presentationMessageId: text(message?.presentationMessageId),
    role: text(message?.role),
    type: text(message?.type),
    pending: message?.pending,
    contentLength: String(message?.content || "").length,
  };
}

export function subSessionMessageIdentity(message = {}) {
  return resolveMessageViewKey(message);
}

function subSessionMessageIdentityCandidates(message = {}) {
  const identity = subSessionMessageIdentity(message);
  return identity ? [identity] : [];
}

function pickRealtimeFinalContentFacet(realtime = {}) {
  if (!(realtime.messageEventState.finalContentSequence > 0)) return {};
  return {
    content: realtime.content,
    eventName: realtime.eventName,
    eventId: realtime.eventId,
    revision: realtime.revision,
    sequence: realtime.sequence,
    sequenceDomain: realtime.sequenceDomain,
    sequenceScopeId: realtime.sequenceScopeId,
    firstSequence: realtime.firstSequence,
    updatedAt: realtime.updatedAt,
  };
}

function mergePersistedSubSessionMessage(realtime = {}, snapshot = {}) {
  const merged = {
    ...realtime,
    ...snapshot,
    ...pickRealtimeFinalContentFacet(realtime),
  };
  logWorkflowDiagnostics("frontend.workflowSubSession.messageMergeEvaluated", () => ({
    turnScopeId: merged.turnScopeId,
    viewKey: subSessionMessageIdentity(merged),
    snapshotPending: snapshot?.pending,
    realtimePending: realtime?.pending,
    mergedPending: merged?.pending,
    snapshotType: text(snapshot?.type),
    realtimeType: text(realtime?.type),
    snapshotContentLength: String(snapshot?.content || "").length,
    realtimeContentLength: String(realtime?.content || "").length,
    snapshotPresentationMessageId: text(snapshot?.presentationMessageId),
    realtimePresentationMessageId: text(realtime?.presentationMessageId),
  }));
  return merged;
}

function buildRealtimeIndexByIdentity(realtimeMessages = []) {
  const realtimeIndexByIdentity = new Map();
  realtimeMessages.forEach((message = {}, index) => {
    for (const identity of subSessionMessageIdentityCandidates(message)) {
      if (!realtimeIndexByIdentity.has(identity)) realtimeIndexByIdentity.set(identity, index);
    }
  });
  return realtimeIndexByIdentity;
}

export function mergeSnapshotWithRealtimeMessages({ snapshotMessages, realtimeMessages }) {
  const realtimeIndexByIdentity = buildRealtimeIndexByIdentity(realtimeMessages);
  const claimedRealtimeIndexes = new Set();
  const messages = snapshotMessages.map((snapshot) => {
    const realtimeIndex = subSessionMessageIdentityCandidates(snapshot)
      .map((identity) => realtimeIndexByIdentity.get(identity))
      .find((index) => Number.isInteger(index));
    const realtime = Number.isInteger(realtimeIndex) ? realtimeMessages[realtimeIndex] : null;
    if (Number.isInteger(realtimeIndex)) claimedRealtimeIndexes.add(realtimeIndex);
    if (!realtime) return { ...snapshot, messageEventState: createMessageEventState() };
    return mergePersistedSubSessionMessage(realtime, snapshot);
  });
  realtimeMessages.forEach((realtime, index) => {
    if (!claimedRealtimeIndexes.has(index)) messages.push(realtime);
  });
  return messages;
}

export function dedupeSubSessionMessagesByIdentity(messages = []) {
  const deduplicatedMessages = [];
  const deduplicatedIndexByIdentity = new Map();
  for (const message of messages) {
    const identity = subSessionMessageIdentity(message);
    if (!identity || !deduplicatedIndexByIdentity.has(identity)) {
      if (identity) deduplicatedIndexByIdentity.set(identity, deduplicatedMessages.length);
      deduplicatedMessages.push(message);
      continue;
    }
    const index = deduplicatedIndexByIdentity.get(identity);
    const previous = deduplicatedMessages[index];
    deduplicatedMessages[index] = mergePersistedSubSessionMessage(previous, message);
  }
  return deduplicatedMessages;
}
