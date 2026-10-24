/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
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

async function readCanonicalManifest({ storageService, sessionDir }) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  if (!isObjectLike(session)) return null;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("Session artifact requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  return session;
}

function sessionMessageReferences(session) {
  return Array.isArray(session.messageOrder) ? session.messageOrder : [];
}

async function materializeOrderedMessages(sessionDir, turnItems, references) {
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
  return references.map((reference) => {
    const messageUid = text(reference?.messageUid);
    const message = messagesByUid.get(messageUid);
    if (message) return message;
    const error = new Error(`session message order references a missing message: ${messageUid}`);
    error.code = SESSION_ERROR_CODE.MESSAGE_ORDER_MESSAGE_MISSING;
    throw error;
  });
}

export async function readSessionArtifact({ storageService = null, sessionDir = "" } = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
  if (!session) return null;
  const turnItems = Array.isArray(session.turnOrder) ? session.turnOrder : [];
  return {
    ...session,
    messages: await materializeOrderedMessages(
      sessionDir,
      turnItems,
      sessionMessageReferences(session),
    ),
  };
}

export async function readSessionTurnView({
  storageService = null,
  sessionDir = "",
  turnScopeIds = [],
} = {}) {
  const session = await readCanonicalManifest({ storageService, sessionDir });
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
  const viewMessageUids = new Set(
    turnItems.flatMap((item) => (Array.isArray(item.messageOrder) ? item.messageOrder : [])),
  );
  return {
    session: {
      ...session,
      messages: await materializeOrderedMessages(
        sessionDir,
        turnItems,
        sessionMessageReferences(session).filter((reference) =>
          viewMessageUids.has(text(reference?.messageUid)),
        ),
      ),
    },
    turnScopeIds: turnItems.map((item) => text(item.turnScopeId)),
  };
}

export async function readSessionArtifactForRepair({
  storageService = null,
  sessionDir = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  if (!isObjectLike(session)) return null;
  if (Number(session.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION) {
    return readSessionArtifact({ storageService, sessionDir });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
