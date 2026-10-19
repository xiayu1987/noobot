/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import {
  requireSessionAggregateVersion,
  SESSION_ARTIFACT_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { text, isObjectLike } from "@noobot/shared/value";
import { messageHash } from "./session-artifact-session/turn-journal-store.js";

export const SESSION_SOURCE_SCHEMA_VERSION = SESSION_ARTIFACT_SCHEMA_VERSION;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObjectLike(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")}`;
}

function manifestMessageHashes(session) {
  const hashes = new Map();
  for (const turn of session.turnOrder) {
    for (const [messageUid, hash] of Object.entries(turn.messageHashes)) {
      hashes.set(messageUid, hash);
    }
  }
  return hashes;
}

function orderedMessageRevisions(session) {
  if (Array.isArray(session.messages)) {
    return session.messages.map((message) => [message.messageUid, messageHash(message)]);
  }
  const hashes = manifestMessageHashes(session);
  return session.messageOrder.map(({ messageUid }) => [messageUid, hashes.get(messageUid)]);
}

export function createSessionDisplaySourceRevision(session) {
  return hash({
    sessionSchemaVersion: SESSION_SOURCE_SCHEMA_VERSION,
    sessionId: session.sessionId,
    parentSessionId: session.parentSessionId,
    caller: session.caller,
    currentTaskId: session.currentTaskId,
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
