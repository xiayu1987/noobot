/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { assertTurnSummaryCheckpoints } from "@noobot/context-protocol/policy/summary";
import { normalizeTurnLifecycleEntity } from "@noobot/authoritative-state/domain";
import { assertSessionArtifactEvents } from "@noobot/event-protocol";
import {
  assertSessionAggregateInvariants,
  assertSessionAggregateShape,
  isCanonicalMessageTimestamp,
  requireSessionAggregateVersion,
  mergeTurnTimingRecord,
  normalizeTurnTimingRecord,
} from "@noobot/session-protocol";
import {
  assertDialogOrderCoversMessages,
  normalizeDialogOrderEntity,
} from "./dialog-order-entity.js";
import { normalizeSelectedConnectorIds } from "@noobot/connector-protocol";
import { normalizeSessionTree } from "@noobot/workspace-protocol/session-tree";
import { objectRecord } from "./entity-primitives.js";
import { normalizeMessagesEntity } from "./message-entity.js";
import { text } from "@noobot/shared/value";

function normalizeTurnTimingsEntity(turnTimings) {
  const byKey = new Map();
  for (const item of turnTimings) {
    const normalized = normalizeTurnTimingRecord(item);
    const existing = byKey.get(normalized.turnScopeId);
    byKey.set(
      normalized.turnScopeId,
      existing ? mergeTurnTimingRecord(existing, normalized) : normalized,
    );
  }
  return [...byKey.values()];
}

function requireSessionTimestamp(session, field) {
  const value = session?.[field];
  if (!isCanonicalMessageTimestamp(value)) {
    throw new TypeError(`session ${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function resolveSessionNormalizationContext(session) {
  const shortMemoryCheckpoint = Number(session?.shortMemoryCheckpoint);
  return {
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
    shortMemoryCheckpoint: context.shortMemoryCheckpoint,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session.dialogOrder),
    turnTimings: normalizeTurnTimingsEntity(session.turnTimings),
    turnLifecycle: normalizeTurnLifecycleEntity(session.turnLifecycle),
    sessionArtifactEvents: assertSessionArtifactEvents(
      session.sessionArtifactEvents,
      session.sessionId,
    ),
    selectedConnectorIds: normalizeSelectedConnectorIds(session?.selectedConnectorIds),
    createdAt: requireSessionTimestamp(session, "createdAt"),
    updatedAt: requireSessionTimestamp(session, "updatedAt"),
  };
}

export function normalizeSessionEntity(session) {
  if ("version" in session || "revision" in session) {
    throw new TypeError(
      "legacy session version fields are not supported; run the session protocol migration",
    );
  }
  assertSessionAggregateShape(session);
  const context = resolveSessionNormalizationContext(session);
  const normalizedMessages = normalizeMessagesEntity(session.messages);
  if ("turnSummaryCheckpoints" in session) {
    assertTurnSummaryCheckpoints(session.turnSummaryCheckpoints);
  }
  const normalizedSession = createNormalizedSessionEntity(session, context, normalizedMessages);
  assertDialogOrderCoversMessages(normalizedSession.dialogOrder, normalizedMessages);
  if (context.customTitle) normalizedSession.customTitle = context.customTitle;
  else delete normalizedSession.customTitle;
  if (context.autoTitle) normalizedSession.autoTitle = context.autoTitle;
  else delete normalizedSession.autoTitle;
  delete normalizedSession.turnTerminalCommits;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree) {
  return normalizeSessionTree(tree);
}
