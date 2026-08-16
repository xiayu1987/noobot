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
} from "./turn-journal-store.js";

export async function readSessionArtifact({
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
  if (!session || typeof session !== "object") return fallback;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("Session artifact requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  const messagesByUid = new Map();
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const records = await readJournalRecords(
      journalPath(sessionDir, item.turnId),
      item.committedBytes,
    );
    const summarySnapshots = await readSummarySnapshots(sessionDir, records);
    for (const message of materializeTurnJournal(records, item.messageOrder, summarySnapshots))
      messagesByUid.set(message.messageUid, message);
  }
  const restoredMessages = (Array.isArray(session.messageOrder) ? session.messageOrder : [])
    .map((reference) => messagesByUid.get(String(reference?.messageUid || "").trim()))
    .filter(Boolean);
  return { ...session, messages: restoredMessages };
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
  if (!session || typeof session !== "object") return fallback;
  if (Number(session.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION) {
    return readSessionArtifact({ storageService, sessionDir, fallback });
  }
  return readSessionForProtocolRepair({ sessionDir, session });
}
