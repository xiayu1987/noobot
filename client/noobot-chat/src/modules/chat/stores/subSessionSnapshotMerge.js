/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { MESSAGE_EVENT_SEQUENCE_DOMAIN } from "@noobot/event-protocol/message-event";
import { logWorkflowDiagnostics } from "../../debug/loggers/workflowDiagnosticsLogger.js";
import { text } from "@noobot/shared/value";

export function summarizeSubSessionMessage(message = {}) {
  return {
    messageId: text(message?.messageId),
    presentationMessageId: text(message?.presentationMessageId),
    role: text(message?.role),
    type: text(message?.type),
    pending: message?.pending,
    contentLength: String(message?.content || "").length,
  };
}

export function subSessionMessageIdentity(message = {}) {
  const stableId = text(
    message?.presentationMessageId ||
      message?.messageId ||
      message?.additional_kwargs?.noobotMessageId,
  );
  return stableId ? `id:${stableId}` : "";
}

function subSessionMessageIdentityCandidates(message = {}) {
  const identity = subSessionMessageIdentity(message);
  return identity ? [identity] : [];
}

function normalizeSubSessionSnapshotMessage(snapshot = {}) {
  const {
    thinking: _thinking,
    toolCall: _toolCall,
    toolResult: _toolResult,
    rawEvents: _rawEvents,
    ...canonicalSnapshot
  } = snapshot && typeof snapshot === "object" ? snapshot : {};
  if (text(canonicalSnapshot?.sequenceDomain) === MESSAGE_EVENT_SEQUENCE_DOMAIN) {
    return canonicalSnapshot;
  }
  const {
    eventId: _eventId,
    sequence: _sequence,
    firstSequence: _firstSequence,
    revision: _revision,
    sequenceDomain: _sequenceDomain,
    sequenceScopeId: _sequenceScopeId,
    ...content
  } = canonicalSnapshot;
  return content;
}

function pickRealtimeFinalContentFacet(realtime = {}) {
  const realtimeOwnsFinalContent =
    Number(realtime?.messageEventState?.finalContentSequence || 0) > 0;
  if (!realtimeOwnsFinalContent) return {};
  return {
    content: realtime.content,
    finalContentSequence: realtime.finalContentSequence,
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

function mergePersistedSubSessionMessage(realtime = {}, snapshot = {}, messageId = "") {
  const canonicalMessageId = text(messageId || realtime.messageId);
  const merged = {
    ...realtime,
    ...snapshot,
    ...pickRealtimeFinalContentFacet(realtime),
  };
  logWorkflowDiagnostics("frontend.workflowSubSession.messageMergeEvaluated", () => ({
    sessionId: text(snapshot?.sessionId || realtime?.sessionId),
    turnScopeId: text(snapshot?.turnScopeId || realtime?.turnScopeId),
    messageId: canonicalMessageId,
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
  return {
    ...merged,
    ...(canonicalMessageId ? { id: canonicalMessageId, messageId: canonicalMessageId } : {}),
  };
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

export function mergeSnapshotWithRealtimeMessages(snapshotMessages = [], realtimeMessages = []) {
  const realtimeIndexByIdentity = buildRealtimeIndexByIdentity(realtimeMessages);
  const claimedRealtimeIndexes = new Set();
  const messages = snapshotMessages.map((rawSnapshot = {}) => {
    const snapshot = normalizeSubSessionSnapshotMessage(rawSnapshot);
    const messageId = text(snapshot.messageId || snapshot?.additional_kwargs?.noobotMessageId);
    const realtimeIndex = subSessionMessageIdentityCandidates(snapshot)
      .map((identity) => realtimeIndexByIdentity.get(identity))
      .find((index) => Number.isInteger(index));
    const realtime = Number.isInteger(realtimeIndex) ? realtimeMessages[realtimeIndex] : null;
    if (Number.isInteger(realtimeIndex)) claimedRealtimeIndexes.add(realtimeIndex);
    if (!realtime) return snapshot;
    return mergePersistedSubSessionMessage(
      realtime,
      snapshot,
      messageId || text(realtime.messageId),
    );
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
    deduplicatedMessages[index] = mergePersistedSubSessionMessage(
      previous,
      message,
      text(message?.messageId || previous?.messageId),
    );
  }
  return deduplicatedMessages;
}
