/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";

export const SESSION_SOURCE_SCHEMA_VERSION = SESSION_ARTIFACT_SCHEMA_VERSION;

function text(value) {
  return String(value || "").trim();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
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

function contentHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function manifestMessageHashes(session) {
  const hashes = new Map();
  for (const turn of Array.isArray(session?.turnOrder) ? session.turnOrder : []) {
    for (const [messageUid, contentHash] of Object.entries(turn?.messageHashes || {})) {
      hashes.set(text(messageUid), text(contentHash));
    }
  }
  return hashes;
}

function orderedMessageRevisions(session) {
  if (Array.isArray(session?.messages)) {
    return session.messages.map((message) => [text(message?.messageUid), contentHash(message)]);
  }
  const hashes = manifestMessageHashes(session);
  return (Array.isArray(session?.messageOrder) ? session.messageOrder : []).map((reference) => {
    const messageUid = text(reference?.messageUid);
    return [messageUid, hashes.get(messageUid) || ""];
  });
}

export function createSessionDisplaySourceRevision(session = {}) {
  return hash({
    sessionSchemaVersion: SESSION_SOURCE_SCHEMA_VERSION,
    sessionId: text(session?.sessionId),
    parentSessionId: text(session?.parentSessionId),
    caller: text(session?.caller || "user") || "user",
    currentTaskId: text(session?.currentTaskId),
    customTitle: text(session?.customTitle),
    createdAt: text(session?.createdAt),
    updatedAt: text(session?.updatedAt),
    aggregateVersion: Math.max(0, Number(session?.aggregateVersion) || 0),
    turnTimings: session?.turnTimings || [],
    turnLifecycle: session?.turnLifecycle || {},
    sessionArtifactEvents: session?.sessionArtifactEvents || [],
    messages: orderedMessageRevisions(session),
  });
}
