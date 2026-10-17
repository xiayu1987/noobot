/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { validateProtocolEvent } from "@noobot/event-protocol";
import {
  assertSessionAggregateInvariants,
  requireSessionAggregateVersion,
} from "@noobot/session-protocol";
import { normalizeDialogOrderEntity } from "./dialog-order-entity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { normalizeSessionTree } from "@noobot/workspace-protocol/session-tree";
import { objectRecord } from "./entity-primitives.js";
import { normalizeMessagesEntity } from "./message-entity.js";
import { firstText, text } from "@noobot/shared/value";

function normalizeSessionArtifactEvents(session = {}, sessionId = "") {
  const events = [];
  const eventIds = new Set();
  for (const envelope of Array.isArray(session?.sessionArtifactEvents)
    ? session.sessionArtifactEvents
    : []) {
    const validation = validateProtocolEvent(envelope);
    const eventId = text(envelope?.identity?.eventId);
    if (
      !validation.valid ||
      !validation.descriptor?.sessionArtifact ||
      (sessionId && text(envelope?.identity?.sessionId) !== sessionId) ||
      !eventId ||
      eventIds.has(eventId)
    ) {
      continue;
    }
    eventIds.add(eventId);
    events.push(envelope);
  }
  return events;
}

function normalizeTurnTimingEntity(timing = {}) {
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) return null;
  const turnScopeId = text(timing?.turnScopeId);
  const dialogProcessId = resolveContextMessageDialogProcessId(timing);
  if (!turnScopeId) return null;
  const thinkingStartedAt = text(timing?.thinkingStartedAt);
  const thinkingFinishedAt = text(timing?.thinkingFinishedAt);
  const modelLoopRoundValue = Number(timing?.modelLoopRound || 0);
  const modelLoopRound =
    Number.isFinite(modelLoopRoundValue) && modelLoopRoundValue > 0 ? modelLoopRoundValue : 0;
  const normalized = { turnScopeId, dialogProcessId };
  if (thinkingStartedAt) normalized.thinkingStartedAt = thinkingStartedAt;
  if (thinkingFinishedAt) normalized.thinkingFinishedAt = thinkingFinishedAt;
  if (modelLoopRound) normalized.modelLoopRound = modelLoopRound;
  return normalized;
}

function normalizeTurnTimingsEntity(turnTimings = []) {
  const source = Array.isArray(turnTimings)
    ? turnTimings
    : Object.values(turnTimings && typeof turnTimings === "object" ? turnTimings : {});
  const byKey = new Map();
  for (const item of source) {
    const normalized = normalizeTurnTimingEntity(item);
    if (!normalized) continue;
    const key = normalized.turnScopeId;
    byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
  }
  return [...byKey.values()];
}

function normalizeCheckpointUidList(values) {
  return [
    ...new Set((Array.isArray(values) ? values : []).map((uid) => text(uid)).filter(Boolean)),
  ];
}

function normalizeTurnSummaryCheckpoints(checkpoints = {}, messages = []) {
  if (!checkpoints || typeof checkpoints !== "object" || Array.isArray(checkpoints)) return {};
  const normalized = {};
  for (const [scopeKey, value] of Object.entries(checkpoints)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const turnScopeId = text(value.turnScopeId || scopeKey);
    const dialogProcessId = text(value.dialogProcessId);
    if (!turnScopeId || !dialogProcessId) continue;
    const checkpointRevision = Math.max(0, Number(value.checkpointRevision) || 0);
    const sessionMessages = Array.isArray(messages) ? messages : [];
    const allMessageUids = new Set(
      sessionMessages.map((message) => text(message?.messageUid)).filter(Boolean),
    );
    const ownedMessageUids = new Set(
      sessionMessages
        .filter(
          (message) =>
            resolveContextMessageDialogProcessId(message) === dialogProcessId &&
            text(message?.turnScopeId) === turnScopeId,
        )
        .map((message) => text(message?.messageUid))
        .filter(Boolean),
    );
    if (!ownedMessageUids.size) continue;
    const receipts = (Array.isArray(value.receipts) ? value.receipts : [])
      .map((receipt) => {
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return null;
        const checkpointId = text(receipt.checkpointId);
        const requestHash = text(receipt.requestHash);
        if (!checkpointId || !requestHash) return null;
        const persistedMessageUids = normalizeCheckpointUidList(receipt.persistedMessageUids);
        const summarizedMessageUids = normalizeCheckpointUidList(receipt.summarizedMessageUids);
        const retainedMessageUids = normalizeCheckpointUidList(receipt.retainedMessageUids);
        if (persistedMessageUids.some((uid) => !ownedMessageUids.has(uid))) return null;
        if (summarizedMessageUids.some((uid) => !allMessageUids.has(uid))) return null;
        return {
          checkpointId,
          checkpointRevision: Math.max(0, Number(receipt.checkpointRevision) || 0),
          requestHash,
          persistedMessageUids,
          summarizedMessageUids,
          retainedMessageUids,
          markedCount: Math.max(0, Number(receipt.markedCount) || 0),
          committedAt: text(receipt.committedAt),
        };
      })
      .filter(Boolean)
      .slice(-50);
    normalized[turnScopeId] = {
      dialogProcessId,
      turnScopeId,
      checkpointRevision,
      receipts,
    };
  }
  return normalized;
}

function resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId }) {
  const nowValue = now();
  const shortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
    nowValue,
    sessionId: firstText(session?.sessionId, sessionId),
    parentSessionId: firstText(session?.parentSessionId, parentSessionId),
    customTitle: text(session?.customTitle),
    shortMemoryCheckpoint: Number.isFinite(shortMemoryCheckpoint) ? shortMemoryCheckpoint : 0,
  };
}

function createNormalizedSessionEntity(session, context, messages) {
  const normalizedBase = { ...objectRecord(session) };

  delete normalizedBase.sessionArtifacts;
  return {
    ...normalizedBase,
    sessionId: context.sessionId,
    parentSessionId: context.parentSessionId,
    aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
    caller: firstText(session?.caller, "user"),
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: text(session?.currentTaskId),
    shortMemoryCheckpoint: context.shortMemoryCheckpoint,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session?.dialogOrder || [], messages),
    turnTimings: normalizeTurnTimingsEntity(session?.turnTimings || []),
    turnLifecycle: normalizeTurnLifecycleEntity(session?.turnLifecycle || {}),
    sessionArtifactEvents: normalizeSessionArtifactEvents(session, context.sessionId),
    selectedConnectorIds: normalizeSelectedConnectorIds(session?.selectedConnectorIds),
    createdAt: firstText(session?.createdAt, context.nowValue),
    updatedAt: firstText(session?.updatedAt, context.nowValue),
  };
}

export function normalizeSessionEntity(
  session = {},
  { now = () => new Date().toISOString(), sessionId = "", parentSessionId = "" } = {},
) {
  if ("version" in session || "revision" in session) {
    throw new TypeError(
      "legacy session version fields are not supported; run the session protocol migration",
    );
  }
  assertSessionAggregateInvariants(session);
  const context = resolveSessionNormalizationContext(session, { now, sessionId, parentSessionId });
  const normalizedMessages = normalizeMessagesEntity(session?.messages || [], now);
  const normalizedTurnSummaryCheckpoints = normalizeTurnSummaryCheckpoints(
    session?.turnSummaryCheckpoints || {},
    normalizedMessages,
  );
  const normalizedSession = createNormalizedSessionEntity(session, context, normalizedMessages);
  if (context.customTitle) normalizedSession.customTitle = context.customTitle;
  else delete normalizedSession.customTitle;
  if (Object.keys(normalizedTurnSummaryCheckpoints).length) {
    normalizedSession.turnSummaryCheckpoints = normalizedTurnSummaryCheckpoints;
  } else {
    delete normalizedSession.turnSummaryCheckpoints;
  }
  delete normalizedSession.turnTerminalCommits;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree = {}) {
  return normalizeSessionTree(tree);
}
