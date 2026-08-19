/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  buildSessionArtifactFileMap,
  readJsonArtifactFile,
} from "../session-artifact-files.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  journalPath,
  materializeTurnJournal,
  readJournalRecords,
  readSummarySnapshots,
} from "./turn-journal-store.js";

function assertCanonicalTurnJournal(session, operation) {
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error(`${operation} requires the canonical turn journal schema`);
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
}

async function materializeTurn(sessionDir, item) {
  const records = await readJournalRecords(
    journalPath(sessionDir, item.turnId),
    item.committedBytes,
  );
  const summarySnapshots = await readSummarySnapshots(sessionDir, records);
  return {
    turnId: item.turnId,
    artifactOrdinal: item.artifactOrdinal,
    committedBytes: Math.max(0, Number(item.committedBytes) || 0),
    turnScopeId: item.turnScopeId,
    dialogProcessId: item.dialogProcessId,
    messages: materializeTurnJournal(records, item.messageOrder, summarySnapshots),
    summarySnapshots,
  };
}

export async function readRecentSessionTurns({
  sessionDir = "",
  limit = 10,
  fallback = null,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, fallback);
  if (!session || typeof session !== "object") return [];
  assertCanonicalTurnJournal(session, "recent Session turns");
  const count = Math.max(0, Number(limit) || 0);
  const turns = [];
  for (const item of (Array.isArray(session.turnOrder) ? session.turnOrder : []).slice(-count)) {
    turns.push(await materializeTurn(sessionDir, item));
  }
  return turns;
}

export async function readSessionTurn({
  sessionDir = "",
  turnScopeId = "",
  dialogProcessId = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, null);
  if (!session || typeof session !== "object") return null;
  assertCanonicalTurnJournal(session, "session turn lookup");
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  if (!normalizedTurnScopeId) {
    const error = new Error("turnScopeId is required");
    error.code = "SESSION_TURN_IDENTITY_REQUIRED";
    throw error;
  }
  const matches = (Array.isArray(session.turnOrder) ? session.turnOrder : []).filter((item) => {
    if (String(item?.turnScopeId || "").trim() !== normalizedTurnScopeId) return false;
    return (
      !normalizedDialogProcessId ||
      String(item?.dialogProcessId || "").trim() === normalizedDialogProcessId
    );
  });
  if (matches.length > 1) {
    const error = new Error("session turn identity is ambiguous");
    error.code = "SESSION_TURN_IDENTITY_AMBIGUOUS";
    throw error;
  }
  if (!matches[0]) return null;
  return {
    sessionId: String(session.sessionId || "").trim(),
    ...(await materializeTurn(sessionDir, matches[0])),
    turnId: String(matches[0].turnId || "").trim(),
    artifactOrdinal: Number(matches[0].artifactOrdinal || 0),
    turnScopeId: String(matches[0].turnScopeId || "").trim(),
    dialogProcessId: String(matches[0].dialogProcessId || "").trim(),
  };
}

export async function readSessionMessageCount({ sessionDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, null);
  if (!session || typeof session !== "object") return 0;
  assertCanonicalTurnJournal(session, "session message count");
  return (Array.isArray(session.turnOrder) ? session.turnOrder : []).reduce(
    (count, item) => count + Math.max(0, Number(item?.messageCount || 0)),
    0,
  );
}
