/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { buildSessionDisplaySummary } from "../session-summary-builders.js";
import {
  assertSessionMessageIdentityInvariants,
  normalizeSessionEntity,
} from "../entities/session-entity.js";
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
  const previousManifest = await readJsonWithStorage({
    storageService,
    artifactPath: files.session,
    fallback: null,
  });
  const previousV5 =
    Number(previousManifest?.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION
      ? previousManifest
      : null;
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
  await mkdir(files.turnsDir, { recursive: true });
  await mkdir(files.turnSnapshotsDir, { recursive: true });
  const turnOrder = [];
  for (const turn of artifactTurns) {
    const previous = previousV5?.turnOrder?.find((item) => item.turnId === turn.turnId);
    const file = journalPath(sessionDir, turn.turnId);
    const previousHashes =
      previous?.messageHashes && typeof previous.messageHashes === "object"
        ? previous.messageHashes
        : {};
    const previousRecords = previous ? await readJournalRecords(file, previous.committedBytes) : [];
    const previousSummaryRecords = collectSummarySnapshotRecords(previousRecords);
    const previousTailRecords = previousRecords.filter(
      (record) => record?.op !== "summary_snapshot",
    );
    const previousCheckpointIds = new Set(
      previousSummaryRecords
        .map((record) => String(record?.checkpointId || "").trim())
        .filter(Boolean),
    );
    let snapshotCompactedJournal = false;
    const nextByUid = new Map(turn.messages.map((message) => [message.messageUid, message]));
    const nextHashes = {};
    const records = [];
    for (const message of turn.messages) {
      const hash = messageHash(message);
      nextHashes[message.messageUid] = hash;
      if (previousHashes[message.messageUid] !== hash)
        records.push({ op: "upsert", messageUid: message.messageUid, message, hash });
    }
    for (const uid of Object.keys(previousHashes))
      if (!nextByUid.has(uid)) records.push({ op: "remove", messageUid: uid });
    const summaryRecords = [...previousSummaryRecords];
    let checkpointRecords = [...previousTailRecords, ...records];
    let previousCheckpointHash = previousSummaryRecords.at(-1)?.contentHash || "";
    for (const receipt of resolveTurnSummaryReceipts(normalizedSessionPayload, turn)) {
      const checkpointId = String(receipt?.checkpointId || "").trim();
      const checkpointRevision = Number(receipt?.checkpointRevision || 0);
      if (
        !checkpointId ||
        !Number.isInteger(checkpointRevision) ||
        checkpointRevision < 1 ||
        previousCheckpointIds.has(checkpointId)
      )
        continue;
      const relativeSnapshotFile = path
        .join(
          SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
          turn.turnId,
          `checkpoint-${String(checkpointRevision).padStart(6, "0")}.json`,
        )
        .replaceAll("\\", "/");
      const snapshotPayload = {
        schemaVersion: 2,
        checkpointId,
        checkpointRevision,
        sessionId: String(normalizedSessionPayload.sessionId || "").trim(),
        turnId: turn.turnId,
        turnScopeId: turn.turnScopeId,
        dialogProcessId: turn.dialogProcessId,
        persistedMessageUids: Array.isArray(receipt?.persistedMessageUids)
          ? receipt.persistedMessageUids
          : [],
        summarizedMessageUids: Array.isArray(receipt?.summarizedMessageUids)
          ? receipt.summarizedMessageUids
          : [],
        committedAt: String(receipt?.committedAt || "").trim(),
        previousCheckpointHash,
        records: checkpointRecords,
      };
      const contentHash = `sha256:${createHash("sha256")
        .update(JSON.stringify(snapshotPayload))
        .digest("hex")}`;
      const snapshotFile = path.join(sessionDir, relativeSnapshotFile);
      await writeSummarySnapshot(snapshotFile, snapshotPayload);
      const indexRecord = summarySnapshotRecord(receipt, turn, relativeSnapshotFile, contentHash);
      records.push(indexRecord);
      summaryRecords.push(indexRecord);
      previousCheckpointIds.add(checkpointId);
      previousCheckpointHash = contentHash;
      checkpointRecords = [];
      snapshotCompactedJournal = true;
    }
    let committedBytes;
    const compact =
      isTerminalTurn(normalizedSessionPayload, turn) &&
      previous?.compacted !== true &&
      summaryRecords.length === 0;
    if (compact) committedBytes = await replaceJournal(file, turn.messages, summaryRecords);
    else if (snapshotCompactedJournal)
      committedBytes = await replaceJournalRecords(file, summaryRecords);
    else committedBytes = await appendJournal(file, records, previous?.committedBytes || 0);
    turnOrder.push({
      turnId: turn.turnId,
      artifactOrdinal: turn.artifactOrdinal,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      file: `${SESSION_ARTIFACT_FILE_NAMES.turnsDir}/${turn.turnId}.jsonl`,
      committedBytes,
      recordCount: compact
        ? turn.messages.length + summaryRecords.length
        : snapshotCompactedJournal
          ? summaryRecords.length
          : (Number(previous?.recordCount) || 0) + records.length,
      messageCount: turn.messages.length,
      messageOrder: turn.messages.map((message) => message.messageUid),
      messageHashes: nextHashes,
      compacted: compact || previous?.compacted === true,
    });
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
  const referenced = new Set(artifactTurns.map((turn) => `${turn.turnId}.jsonl`));
  try {
    for (const entry of await readdir(files.turnsDir, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) &&
        !referenced.has(entry.name)
      ) {
        await rm(path.join(files.turnsDir, entry.name), { force: true });
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
  try {
    for (const turnEntry of await readdir(files.turnSnapshotsDir, { withFileTypes: true })) {
      if (!turnEntry.isDirectory()) continue;
      const turnDir = path.join(files.turnSnapshotsDir, turnEntry.name);
      for (const entry of await readdir(turnDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const relative = path
          .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnEntry.name, entry.name)
          .replaceAll("\\", "/");
        if (!referencedSnapshots.has(relative))
          await rm(path.join(turnDir, entry.name), { force: true });
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    files,
    session: normalizedSessionPayload,
    sessionSummary: summaryPayload,
  };
}
