/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import {
  assertSessionManifestLayout,
  requireSessionAggregateVersion,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { text, stableValue } from "@noobot/shared/value";

export const SESSION_SOURCE_SCHEMA_VERSION = SESSION_ARTIFACT_SCHEMA_VERSION;

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function orderedMessageRevisions(session) {
  assertSessionManifestLayout(session);
  const hashes = new Map(session.turnOrder.flatMap((turn) => Object.entries(turn.messageHashes)));
  return session.messageOrder.map(({ messageUid }) => [messageUid, hashes.get(messageUid)]);
}

export function createSessionDisplaySourceRevision(session) {
  return hash({
    sessionSchemaVersion: SESSION_SOURCE_SCHEMA_VERSION,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    caller: session.caller,
    customTitle: text(session.customTitle),
    autoTitle: text(session.autoTitle),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    aggregateVersion: requireSessionAggregateVersion(session.aggregateVersion),
    turnTimings: session.turnTimings,
    turnLifecycle: session.turnLifecycle,
    sessionArtifactEvents: session.sessionArtifactEvents,
    messages: orderedMessageRevisions(session),
  });
}
