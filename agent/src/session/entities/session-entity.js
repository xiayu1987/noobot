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
  requireSessionSettings,
  normalizeTurnTimingRecords,
} from "@noobot/session-protocol";
import {
  assertDialogOrderCoversMessages,
  normalizeDialogOrderEntity,
} from "./dialog-order-entity.js";
import { normalizeSessionTree } from "@noobot/workspace-protocol/session-tree";
import { normalizeMessagesEntity } from "./message-entity.js";
import { text } from "@noobot/shared/value";

function requireSessionTimestamp(session, field) {
  const value = session?.[field];
  if (!isCanonicalMessageTimestamp(value)) {
    throw new TypeError(`session ${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function createNormalizedSessionEntity(session, messages) {
  return {
    ...session,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    aggregateVersion: requireSessionAggregateVersion(session?.aggregateVersion),
    caller: session.caller,
    modelAlias: session.modelAlias,
    messages,
    dialogOrder: normalizeDialogOrderEntity(session.dialogOrder),
    turnTimings: normalizeTurnTimingRecords(session.turnTimings),
    turnLifecycle: normalizeTurnLifecycleEntity(session.turnLifecycle),
    sessionArtifactEvents: assertSessionArtifactEvents(
      session.sessionArtifactEvents,
      session.sessionId,
    ),
    selectedConnectorIds: [...session.selectedConnectorIds],
    createdAt: requireSessionTimestamp(session, "createdAt"),
    updatedAt: requireSessionTimestamp(session, "updatedAt"),
  };
}

export function normalizeSessionEntity(session) {
  assertSessionAggregateShape(session);
  requireSessionSettings(session);
  return normalizeSessionAggregateEntity({
    ...session,
    messages: normalizeMessagesEntity(session.messages),
  });
}

function normalizeSessionAggregateEntity(session) {
  assertSessionAggregateShape(session);
  const autoTitle = text(session.autoTitle);
  const normalizedMessages = session.messages;
  if ("turnSummaryCheckpoints" in session) {
    assertTurnSummaryCheckpoints(session.turnSummaryCheckpoints);
  }
  const normalizedSession = createNormalizedSessionEntity(session, normalizedMessages);
  assertDialogOrderCoversMessages(normalizedSession.dialogOrder, normalizedMessages);
  if (autoTitle) normalizedSession.autoTitle = autoTitle;
  else delete normalizedSession.autoTitle;
  return assertSessionAggregateInvariants(normalizedSession);
}

export function normalizeSessionTreeEntity(tree) {
  return normalizeSessionTree(tree);
}
