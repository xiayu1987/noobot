/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { buildSessionDisplaySummary } from "../session-summary-builders.js";
import { assertSessionMessageIdentityInvariants } from "../entities/message-entity.js";
import { normalizeSessionEntity } from "../entities/session-entity.js";
import {
  buildSessionArtifactFileMap,
  SESSION_ARTIFACT_FILE_NAMES,
} from "../session-artifact-files.js";
import { readJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";
import { writeSessionSummaryDetails } from "./summary-detail-store.js";
import { splitSessionMessages } from "./turn-message-partition.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  appendJournal,
  collectSummarySnapshotRecords,
  isTerminalTurn,
  journalPath,
  messageHash,
  readJournalRecords,
  replaceJournal,
  replaceJournalRecords,
  resolveTurnSummaryReceipts,
  summarySnapshotRecord,
  turnIdOrdinal,
  turnKey,
  writeSummarySnapshot,
} from "./turn-journal-store.js";

function ignoreMissingDirectory(error) {
  if (error?.code !== "ENOENT") throw error;
}

async function readPreviousTurnManifest({ storageService, files }) {
  const previousManifest = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  return Number(previousManifest?.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION
    ? previousManifest
    : null;
}

function assignArtifactTurnIds(turns, previousV5) {
  const previousTurns = Array.isArray(previousV5?.turnOrder) ? previousV5.turnOrder : [];
  const previousByKey = new Map();
  for (const item of previousTurns) {
    const key = turnKey(item);
    const matches = previousByKey.get(key) || [];
    matches.push(item);
    previousByKey.set(key, matches);
  }
  let turnArtifactSequence = Math.max(
    Number(previousV5?.turnArtifactSequence) || 0,
    ...previousTurns.map((item) => turnIdOrdinal(item?.turnId)),
  );
  const usedTurnIds = new Set();
  const artifactTurns = turns.map(({ sourceIndices, ...turn }, index) => {
    const previous = previousByKey.get(turnKey(turn))?.shift();
    let turnId = String(previous?.turnId || "").trim();
    if (!turnId || usedTurnIds.has(turnId)) {
      turnArtifactSequence += 1;
      turnId = `turn-${String(turnArtifactSequence).padStart(6, "0")}`;
    }
    usedTurnIds.add(turnId);
    return { ...turn, turnId, artifactOrdinal: index + 1 };
  });
  return { artifactTurns, turnArtifactSequence };
}

function diffTurnMessages(messages, previousHashes) {
  const nextByUid = new Map(messages.map((message) => [message.messageUid, message]));
  const nextHashes = {};
  const records = [];
  for (const message of messages) {
    const hash = messageHash(message);
    nextHashes[message.messageUid] = hash;
    if (previousHashes[message.messageUid] !== hash)
      records.push({ op: "upsert", messageUid: message.messageUid, message, hash });
  }
  for (const uid of Object.keys(previousHashes))
    if (!nextByUid.has(uid)) records.push({ op: "remove", messageUid: uid });
  return { nextHashes, records };
}

function receiptCheckpoint(receipt, previousCheckpointIds) {
  const checkpointId = String(receipt?.checkpointId || "").trim();
  const checkpointRevision = Number(receipt?.checkpointRevision || 0);
  const valid =
    checkpointId &&
    Number.isInteger(checkpointRevision) &&
    checkpointRevision >= 1 &&
    !previousCheckpointIds.has(checkpointId);
  return valid ? { checkpointId, checkpointRevision } : null;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function buildSummarySnapshotPayload({
  sessionPayload,
  turn,
  receipt,
  checkpoint,
  previousCheckpointHash,
  records,
}) {
  return {
    schemaVersion: 2,
    checkpointId: checkpoint.checkpointId,
    checkpointRevision: checkpoint.checkpointRevision,
    sessionId: String(sessionPayload.sessionId || "").trim(),
    turnId: turn.turnId,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    persistedMessageUids: arrayOrEmpty(receipt?.persistedMessageUids),
    summarizedMessageUids: arrayOrEmpty(receipt?.summarizedMessageUids),
    committedAt: String(receipt?.committedAt || "").trim(),
    previousCheckpointHash,
    records,
  };
}

function summarySnapshotRelativeFile(turnId, checkpointRevision) {
  return path
    .join(
      SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
      turnId,
      `checkpoint-${String(checkpointRevision).padStart(6, "0")}.json`,
    )
    .replaceAll("\\", "/");
}

async function writeTurnSummarySnapshots({
  sessionDir,
  sessionPayload,
  turn,
  previousRecords,
  records,
}) {
  const summaryRecords = collectSummarySnapshotRecords(previousRecords);
  const previousCheckpointIds = new Set(
    summaryRecords.map((record) => String(record?.checkpointId || "").trim()).filter(Boolean),
  );
  let checkpointRecords = [
    ...previousRecords.filter((record) => record?.op !== "summary_snapshot"),
    ...records,
  ];
  let previousCheckpointHash = summaryRecords.at(-1)?.contentHash || "";
  let snapshotCompactedJournal = false;
  for (const receipt of resolveTurnSummaryReceipts(sessionPayload, turn)) {
    const checkpoint = receiptCheckpoint(receipt, previousCheckpointIds);
    if (!checkpoint) continue;
    const relativeSnapshotFile = summarySnapshotRelativeFile(
      turn.turnId,
      checkpoint.checkpointRevision,
    );
    const snapshotPayload = buildSummarySnapshotPayload({
      sessionPayload,
      turn,
      receipt,
      checkpoint,
      previousCheckpointHash,
      records: checkpointRecords,
    });
    const contentHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(snapshotPayload))
      .digest("hex")}`;
    await writeSummarySnapshot(path.join(sessionDir, relativeSnapshotFile), snapshotPayload);
    const indexRecord = summarySnapshotRecord(receipt, turn, relativeSnapshotFile, contentHash);
    records.push(indexRecord);
    summaryRecords.push(indexRecord);
    previousCheckpointIds.add(checkpoint.checkpointId);
    previousCheckpointHash = contentHash;
    checkpointRecords = [];
    snapshotCompactedJournal = true;
  }
  return { summaryRecords, snapshotCompactedJournal };
}

async function commitTurnJournal({
  file,
  turn,
  previous,
  records,
  summaryRecords,
  compact,
  snapshotCompactedJournal,
}) {
  if (compact) {
    return {
      committedBytes: await replaceJournal(file, turn.messages, summaryRecords),
      recordCount: turn.messages.length + summaryRecords.length,
    };
  }
  if (snapshotCompactedJournal) {
    return {
      committedBytes: await replaceJournalRecords(file, summaryRecords),
      recordCount: summaryRecords.length,
    };
  }
  return {
    committedBytes: await appendJournal(file, records, previous?.committedBytes || 0),
    recordCount: (Number(previous?.recordCount) || 0) + records.length,
  };
}

async function writeTurnArtifact({ sessionDir, sessionPayload, turn, previousV5 }) {
  const previous = previousV5?.turnOrder?.find((item) => item.turnId === turn.turnId);
  const file = journalPath(sessionDir, turn.turnId);
  const previousHashes =
    previous?.messageHashes && typeof previous.messageHashes === "object"
      ? previous.messageHashes
      : {};
  const previousRecords = previous ? await readJournalRecords(file, previous.committedBytes) : [];
  const { nextHashes, records } = diffTurnMessages(turn.messages, previousHashes);
  const { summaryRecords, snapshotCompactedJournal } = await writeTurnSummarySnapshots({
    sessionDir,
    sessionPayload,
    turn,
    previousRecords,
    records,
  });
  const compact =
    isTerminalTurn(sessionPayload, turn) &&
    previous?.compacted !== true &&
    summaryRecords.length === 0;
  const { committedBytes, recordCount } = await commitTurnJournal({
    file,
    turn,
    previous,
    records,
    summaryRecords,
    compact,
    snapshotCompactedJournal,
  });
  return {
    turnId: turn.turnId,
    artifactOrdinal: turn.artifactOrdinal,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    file: `${SESSION_ARTIFACT_FILE_NAMES.turnsDir}/${turn.turnId}.jsonl`,
    committedBytes,
    recordCount,
    messageCount: turn.messages.length,
    messageOrder: turn.messages.map((message) => message.messageUid),
    messageHashes: nextHashes,
    compacted: compact || previous?.compacted === true,
  };
}

function isJournalFileName(name) {
  return name.endsWith(".json") || name.endsWith(".jsonl");
}

async function pruneUnreferencedJournals(files, artifactTurns) {
  const referenced = new Set(artifactTurns.map((turn) => `${turn.turnId}.jsonl`));
  try {
    for (const entry of await readdir(files.turnsDir, { withFileTypes: true })) {
      if (entry.isFile() && isJournalFileName(entry.name) && !referenced.has(entry.name)) {
        await rm(path.join(files.turnsDir, entry.name), { force: true });
      }
    }
  } catch (error) {
    ignoreMissingDirectory(error);
  }
}

async function collectReferencedSnapshots(sessionDir, turnOrder) {
  const referencedSnapshots = new Set();
  for (const turn of turnOrder) {
    const journalRecords = await readJournalRecords(
      journalPath(sessionDir, turn.turnId),
      turn.committedBytes,
    );
    for (const record of collectSummarySnapshotRecords(journalRecords)) {
      referencedSnapshots.add(String(record?.file || "").replaceAll("\\", "/"));
    }
  }
  return referencedSnapshots;
}

async function pruneTurnSnapshotDir(turnDir, turnDirName, referencedSnapshots) {
  for (const entry of await readdir(turnDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const relative = path
      .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnDirName, entry.name)
      .replaceAll("\\", "/");
    if (!referencedSnapshots.has(relative))
      await rm(path.join(turnDir, entry.name), { force: true });
  }
}

async function pruneUnreferencedSnapshots(sessionDir, files, turnOrder) {
  const referencedSnapshots = await collectReferencedSnapshots(sessionDir, turnOrder);
  try {
    for (const turnEntry of await readdir(files.turnSnapshotsDir, { withFileTypes: true })) {
      if (!turnEntry.isDirectory()) continue;
      const turnDir = path.join(files.turnSnapshotsDir, turnEntry.name);
      await pruneTurnSnapshotDir(turnDir, turnEntry.name, referencedSnapshots);
    }
  } catch (error) {
    ignoreMissingDirectory(error);
  }
}

export async function writeSessionArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
  atomic = true,
  now = () => new Date().toISOString(),
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  const normalizedSessionPayload = normalizeSessionEntity(sessionPayload, { now });
  assertSessionMessageIdentityInvariants(normalizedSessionPayload.messages);
  const summaryPayload = buildSessionDisplaySummary(normalizedSessionPayload);
  await writeSessionSummaryDetails({ storageService, sessionDir, summaryPayload });
  const { turns } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousV5 = await readPreviousTurnManifest({ storageService, files });
  const { artifactTurns, turnArtifactSequence } = assignArtifactTurnIds(turns, previousV5);
  await mkdir(files.turnsDir, { recursive: true });
  await mkdir(files.turnSnapshotsDir, { recursive: true });
  const turnOrder = [];
  for (const turn of artifactTurns) {
    turnOrder.push(
      await writeTurnArtifact({
        sessionDir,
        sessionPayload: normalizedSessionPayload,
        turn,
        previousV5,
      }),
    );
  }
  const manifest = {
    ...normalizedSessionPayload,
    schemaVersion: TURN_JOURNAL_SCHEMA_VERSION,
    messageIdentityVersion: 1,
    turnArtifactSequence,
    turnOrder,
    messageOrder: normalizedSessionPayload.messages.map((message) => ({
      messageUid: message.messageUid,
    })),
  };
  delete manifest.messages;
  await Promise.all([
    writeJsonWithStorage({
      storageService,
      artifactPath: files.session,
      payload: manifest,
      atomic,
    }),
    writeJsonWithStorage({
      storageService,
      artifactPath: files.sessionSummary,
      payload: summaryPayload,
      atomic: true,
    }),
  ]);
  await pruneUnreferencedJournals(files, artifactTurns);
  await pruneUnreferencedSnapshots(sessionDir, files, turnOrder);
  return {
    files,
    session: normalizedSessionPayload,
    sessionSummary: summaryPayload,
  };
}
