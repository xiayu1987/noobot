/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { buildSessionArtifactFileMap, readJsonArtifactFile } from "../session-artifact-files.js";
import {
  assertCanonicalSessionManifest,
  journalPath,
  materializeTurnJournal,
  readJournalRecords,
  readSummarySnapshots,
} from "./turn-journal-store.js";
import { text, isObjectLike } from "@noobot/shared/value";

async function materializeTurn(sessionDir, item) {
  const records = await readJournalRecords(
    journalPath(sessionDir, item.turnId),
    item.committedBytes,
  );
  const summarySnapshots = await readSummarySnapshots(sessionDir, item.summarySnapshots);
  return {
    turnId: item.turnId,
    artifactOrdinal: item.artifactOrdinal,
    committedBytes: item.committedBytes,
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
  if (!isObjectLike(session)) return [];
  assertCanonicalSessionManifest(session, "recent Session turns");
  const count = Math.max(0, Number(limit) || 0);
  const turns = [];
  for (const item of session.turnOrder.slice(-count)) {
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
  if (!isObjectLike(session)) return null;
  assertCanonicalSessionManifest(session, "session turn lookup");
  const normalizedTurnScopeId = text(turnScopeId);
  const normalizedDialogProcessId = text(dialogProcessId);
  if (!normalizedTurnScopeId) {
    const error = new Error("turnScopeId is required");
    error.code = "SESSION_TURN_IDENTITY_REQUIRED";
    throw error;
  }
  const matches = session.turnOrder.filter((item) => {
    if (item.turnScopeId !== normalizedTurnScopeId) return false;
    return !normalizedDialogProcessId || item.dialogProcessId === normalizedDialogProcessId;
  });
  if (matches.length > 1) {
    const error = new Error("session turn identity is ambiguous");
    error.code = "SESSION_TURN_IDENTITY_AMBIGUOUS";
    throw error;
  }
  if (!matches[0]) return null;
  return {
    sessionId: text(session.sessionId),
    ...(await materializeTurn(sessionDir, matches[0])),
  };
}

export async function readSessionMessageCount({ sessionDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, null);
  if (!isObjectLike(session)) return 0;
  assertCanonicalSessionManifest(session, "session message count");
  return session.turnOrder.reduce((count, item) => count + item.messageOrder.length, 0);
}
