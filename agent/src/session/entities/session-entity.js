/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeTurnSummaryCheckpoints } from "@noobot/context-protocol/policy/summary";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { validateProtocolEvent } from "@noobot/event-protocol";
import {
  assertSessionAggregateInvariants,
  assertSessionAggregateShape,
  requireSessionAggregateVersion,
  normalizeDialogProcessId,
} from "@noobot/session-protocol";
import {
  assertDialogOrderCoversMessages,
  normalizeDialogOrderEntity,
} from "./dialog-order-entity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { normalizeSessionTree } from "@noobot/workspace-protocol/session-tree";
import { objectRecord } from "./entity-primitives.js";
import { normalizeMessagesEntity } from "./message-entity.js";
import { firstText, text, isPlainObject } from "@noobot/shared/value";

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
  if (!isPlainObject(timing)) return null;
  const turnScopeId = text(timing?.turnScopeId);
  const dialogProcessId = normalizeDialogProcessId(timing?.dialogProcessId);
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

function normalizeTurnTimingsEntity(turnTimings) {
  const byKey = new Map();
  for (const item of turnTimings) {
    const normalized = normalizeTurnTimingEntity(item);
    if (!normalized) continue;
    const key = normalized.turnScopeId;
    byKey.set(key, { ...(byKey.get(key) || {}), ...normalized });
  }
  return [...byKey.values()];
}

function resolveSessionNormalizationContext(session, { now }) {
  const nowValue = now();
  const shortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
    nowValue,
    customTitle: text(session?.customTitle),
    autoTitle: text(session?.autoTitle),
    shortMemoryCheckpoint: Number.isFinite(shortMemoryCheckpoint) ? shortMemoryCheckpoint : 0,
  };
}

function createNormalizedSessionEntity(session, context, messages) {
  const normalizedBase = { ...objectRecord(session) };

  delete normalizedBase.sessionArtifacts;
  return {
    ...normalizedBase,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
    caller: session.caller,
    modelAlias: String(session?.modelAlias || ""),
    currentTaskId: text(session?.currentTaskId),
    shortMemoryCheckpoint: context.shortMemoryCheckpoint,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session.dialogOrder),
    turnTimings: normalizeTurnTimingsEntity(session.turnTimings),
    turnLifecycle: normalizeTurnLifecycleEntity(session.turnLifecycle),
    sessionArtifactEvents: normalizeSessionArtifactEvents(session, session.sessionId),
    selectedConnectorIds: normalizeSelectedConnectorIds(session?.selectedConnectorIds),
    createdAt: firstText(session?.createdAt, context.nowValue),
    updatedAt: firstText(session?.updatedAt, context.nowValue),
  };
}

export function normalizeSessionEntity(
  session = {},
  { now = () => new Date().toISOString() } = {},
) {
  if ("version" in session || "revision" in session) {
    throw new TypeError(
      "legacy session version fields are not supported; run the session protocol migration",
    );
  }
  assertSessionAggregateShape(session);
  const context = resolveSessionNormalizationContext(session, { now });
  const normalizedMessages = normalizeMessagesEntity(session.messages, now);
  const normalizedTurnSummaryCheckpoints = normalizeTurnSummaryCheckpoints(
    session?.turnSummaryCheckpoints || {},
  );
  const normalizedSession = createNormalizedSessionEntity(session, context, normalizedMessages);
  assertDialogOrderCoversMessages(normalizedSession.dialogOrder, normalizedMessages);
  if (context.customTitle) normalizedSession.customTitle = context.customTitle;
  else delete normalizedSession.customTitle;
  if (context.autoTitle) normalizedSession.autoTitle = context.autoTitle;
  else delete normalizedSession.autoTitle;
  if (Object.keys(normalizedTurnSummaryCheckpoints).length) {
    normalizedSession.turnSummaryCheckpoints = normalizedTurnSummaryCheckpoints;
  } else {
    delete normalizedSession.turnSummaryCheckpoints;
  }
  delete normalizedSession.turnTerminalCommits;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree) {
  return normalizeSessionTree(tree);
}
