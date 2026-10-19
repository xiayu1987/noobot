/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readSessionForProtocolRepair } from "@noobot/session-repair";
import { buildSessionArtifactFileMap } from "../session-artifact-files.js";
import { readJsonWithStorage } from "./artifact-json-io.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  journalPath,
  materializeTurnJournal,
  readJournalRecords,
  readSummarySnapshots,
  turnArtifactRequiresRewrite,
} from "./turn-journal-store.js";
import { text, isObjectLike } from "@noobot/shared/value";

async function readCanonicalManifest({ storageService, sessionDir, fallback }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback,
  });
  if (!isObjectLike(session)) return null;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("Session artifact requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  return session;
}

async function materializeOrderedMessages(sessionDir, session, turnItems) {
  const messagesByUid = new Map();
  for (const item of turnItems) {
    const records = await readJournalRecords(
      journalPath(sessionDir, item.turnId),
      item.committedBytes,
    );
    const summarySnapshots = await readSummarySnapshots(sessionDir, item.summarySnapshots);
    for (const message of materializeTurnJournal(records, item.messageOrder, summarySnapshots))
      messagesByUid.set(message.messageUid, message);
  }
  return (Array.isArray(session.messageOrder) ? session.messageOrder : [])
    .map((reference) => messagesByUid.get(text(reference?.messageUid)))
    .filter(Boolean);
}

export async function readSessionArtifact({
  storageService = null,
  sessionDir = "",
  fallback = null,
} = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir, fallback });
  if (!session) return fallback;
  const turnItems = Array.isArray(session.turnOrder) ? session.turnOrder : [];
  return { ...session, messages: await materializeOrderedMessages(sessionDir, session, turnItems) };
}

export async function readSessionTurnView({
  storageService = null,
  sessionDir = "",
  turnScopeIds = [],
} = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir, fallback: null });
  if (!session) return null;
  const scopes = new Set(turnScopeIds.map((turnScopeId) => text(turnScopeId)));
  const turnOrder = Array.isArray(session.turnOrder) ? session.turnOrder : [];
  const lastMessageUid = text(session.messageOrder?.at?.(-1)?.messageUid);
  const turnItems = turnOrder.filter(
    (item) =>
      scopes.has(text(item?.turnScopeId)) ||
      (lastMessageUid && item?.messageOrder?.includes(lastMessageUid)) ||
      turnArtifactRequiresRewrite(session, item),
  );
  return {
    session: {
      ...session,
      messages: await materializeOrderedMessages(sessionDir, session, turnItems),
    },
    turnScopeIds: turnItems.map((item) => text(item.turnScopeId)),
  };
}

export async function readSessionArtifactForRepair({
  storageService = null,
  sessionDir = "",
  fallback = null,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback,
  });
  if (!isObjectLike(session)) return fallback;
  if (Number(session.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION) {
    return readSessionArtifact({ storageService, sessionDir, fallback });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
