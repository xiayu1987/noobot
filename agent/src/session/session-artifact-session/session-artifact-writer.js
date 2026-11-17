/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  compactSessionStorageJournalRecords,
  createSessionStorageMessageIndex,
} from "@noobot/session-protocol";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { diffTurnEntries } from "./turn-message-diff.js";
import { recordStorageWork } from "./storage-transaction.js";
import { normalizeSessionEntity } from "../entities/session-entity.js";
import { materializeCommittedTurnEvents } from "../authority-outbox-store/outbox-journal.js";
import {
  buildSessionArtifactFileMap,
  SESSION_ARTIFACT_FILE_NAMES,
} from "../session-artifact-files.js";
import { readOptionalJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";
import { writeSessionArtifactEvents } from "./artifact-event-journal.js";
import { buildStoredCheckpointReceipts } from "./checkpoint-receipts.js";
import { buildSessionListFacts } from "./session-list-facts.js";
import { getTurnMaterializer } from "./turn-materializer.js";
import { beginArtifactPruning, pruneSessionArtifacts } from "./artifact-pruning.js";
import { splitSessionMessages } from "./turn-message-partition.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  appendJournal,
  assertCanonicalSessionManifest,
  isTerminalTurn,
  journalPath,
  readJournalRecords,
  receiptCheckpoint,
  replaceJournal,
  replaceJournalRecords,
  resolveTurnJournalPath,
  resolveTurnSummaryReceipts,
  summarySnapshotContentHash,
  summarySnapshotIndex,
  turnIdOrdinal,
  turnKey,
  writeSummarySnapshot,
} from "./turn-journal-store.js";

export const SESSION_ARTIFACT_PREDECESSOR = Object.freeze({
  CANONICAL: "canonical",
  LEGACY_REWRITE: "legacy_rewrite",
});

const SESSION_ARTIFACT_PREDECESSOR_VALUES = new Set(Object.values(SESSION_ARTIFACT_PREDECESSOR));

function requireSessionArtifactPredecessor(predecessor) {
  if (!SESSION_ARTIFACT_PREDECESSOR_VALUES.has(predecessor)) {
    throw new TypeError("Session artifact write requires SESSION_ARTIFACT_PREDECESSOR predecessor");
  }
  return predecessor;
}

async function readPreviousTurnManifest({ storageService, files, predecessor }) {
  requireSessionArtifactPredecessor(predecessor);
  const previousManifest = await readOptionalJsonWithStorage({
    storageService,
    artifactPath: files.session,
  });
  if (previousManifest === null) return null;
  if (
    predecessor === SESSION_ARTIFACT_PREDECESSOR.LEGACY_REWRITE &&
    previousManifest.schemaVersion !== TURN_JOURNAL_SCHEMA_VERSION
  )
    return null;
  const canonical = assertCanonicalSessionManifest(previousManifest, "Session artifact write");
  await materializeCommittedTurnEvents(path.dirname(files.session), canonical.turnLifecycle);
  return canonical;
}

function createTurnEntriesReader({ storageService, sessionDir }) {
  const entriesByTurn = new Map();
  return async (item) => {
    if (!item) return [];
    if (!entriesByTurn.has(item)) {
      entriesByTurn.set(
        item,
        await getTurnMaterializer().materializeEntries({ storageService, sessionDir, item }),
      );
    }
    return entriesByTurn.get(item);
  };
}

function assignArtifactTurnIds(turns, previousManifest) {
  const previousTurns = previousManifest ? previousManifest.turnOrder : [];
  const previousByKey = new Map();
  for (const item of previousTurns) {
    const key = turnKey(item);
    const matches = previousByKey.get(key) || [];
    matches.push(item);
    previousByKey.set(key, matches);
  }
  let turnArtifactSequence = Math.max(
    previousManifest ? previousManifest.turnArtifactSequence : 0,
    ...previousTurns.map((item) => turnIdOrdinal(item.turnId)),
  );
  const usedTurnIds = new Set();
  const artifactTurns = turns.map((turn, index) => {
    const previous = previousByKey.get(turnKey(turn))?.shift();
    let turnId = previous?.turnId;
    if (!turnId || usedTurnIds.has(turnId)) {
      turnArtifactSequence += 1;
      turnId = `turn-${String(turnArtifactSequence).padStart(6, "0")}`;
    }
    usedTurnIds.add(turnId);
    return { ...turn, turnId, artifactOrdinal: index + 1 };
  });
  return { artifactTurns, turnArtifactSequence };
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
    schemaVersion: SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
    checkpointId: checkpoint.checkpointId,
    checkpointRevision: checkpoint.checkpointRevision,
    sessionId: sessionPayload.sessionId,
    turnId: turn.turnId,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    persistedMessageUids: [...receipt.persistedMessageUids],
    summarizedMessageUids: [...receipt.summarizedMessageUids],
    committedAt: receipt.committedAt,
    previousCheckpointHash,
    records: compactSessionStorageJournalRecords(records),
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
  file,
  previous,
  records,
}) {
  const summarySnapshots = previous ? [...previous.summarySnapshots] : [];
  const previousCheckpointIds = new Set(summarySnapshots.map((snapshot) => snapshot.checkpointId));
  let checkpointRecords = null;
  let previousCheckpointHash = summarySnapshots.length ? summarySnapshots.at(-1).contentHash : "";
  for (const receipt of resolveTurnSummaryReceipts(sessionPayload, turn)) {
    const checkpoint = receiptCheckpoint(receipt, previousCheckpointIds);
    if (!checkpoint) continue;
    checkpointRecords ??= [
      ...(previous ? await readJournalRecords(file, previous.committedBytes) : []),
      ...records,
    ];
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
    const contentHash = summarySnapshotContentHash(snapshotPayload);
    await writeSummarySnapshot(path.join(sessionDir, relativeSnapshotFile), snapshotPayload);
    summarySnapshots.push(summarySnapshotIndex(receipt, relativeSnapshotFile, contentHash));
    previousCheckpointIds.add(checkpoint.checkpointId);
    previousCheckpointHash = contentHash;
    checkpointRecords = [];
  }
  return { summarySnapshots, snapshotCompactedJournal: checkpointRecords !== null };
}

async function commitTurnJournal({
  file,
  turn,
  previous,
  records,
  compact,
  snapshotCompactedJournal,
}) {
  if (compact || snapshotCompactedJournal) {
    const nextFile = path.join(path.dirname(file), `${turn.turnId}-${randomUUID()}.jsonl`);
    return {
      file: nextFile,
      committedBytes: compact
        ? await replaceJournal(nextFile, turn.messages, turn.positions)
        : await replaceJournalRecords(nextFile, []),
      recordCount: compact ? turn.messages.length + 1 : 0,
    };
  }
  return {
    file,
    committedBytes: await appendJournal(file, records, previous ? previous.committedBytes : 0),
    recordCount: (previous ? previous.recordCount : 0) + records.length,
  };
}

async function writeTurnArtifact({
  readTurnEntries,
  committedProjections,
  sessionDir,
  sessionPayload,
  turn,
  previousManifest,
}) {
  const previous = previousManifest?.turnOrder.find((item) => item.turnId === turn.turnId);
  const file = previous
    ? resolveTurnJournalPath(sessionDir, previous.file)
    : journalPath(sessionDir, turn.turnId);
  const previousEntries = await readTurnEntries(previous);
  const { records, materializedEntries, changes } = diffTurnEntries(turn, previousEntries);
  const { summarySnapshots, snapshotCompactedJournal } = await writeTurnSummarySnapshots({
    sessionDir,
    sessionPayload,
    turn,
    file,
    previous,
    records,
  });
  const compact =
    isTerminalTurn(sessionPayload, turn) &&
    previous?.compacted !== true &&
    summarySnapshots.length === 0;
  const {
    file: committedFile,
    committedBytes,
    recordCount,
  } = await commitTurnJournal({
    file,
    turn,
    previous,
    records,
    compact,
    snapshotCompactedJournal,
  });
  recordStorageWork("indexedMessages", materializedEntries.length);
  const item = {
    turnId: turn.turnId,
    artifactOrdinal: turn.artifactOrdinal,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    file: path.relative(sessionDir, committedFile).replaceAll("\\", "/"),
    committedBytes,
    recordCount,
    ...createSessionStorageMessageIndex(materializedEntries, previousEntries),
    summarySnapshots,
    compacted: compact || previous?.compacted === true,
  };
  committedProjections.push(
    await getTurnMaterializer().prepareCommittedEntries({
      sessionDir,
      item,
      materializedEntries,
      changes,
      checkpointed: snapshotCompactedJournal,
    }),
  );
  return item;
}

export async function writeSessionArtifact({
  storageService,
  sessionDir,
  sessionPayload,
  atomic,
  predecessor,
}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  const normalizedSessionPayload = normalizeSessionEntity(sessionPayload);
  const { turns } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousManifest = await readPreviousTurnManifest({ storageService, files, predecessor });
  const fullScan = await beginArtifactPruning(files);
  const { artifactTurns, turnArtifactSequence } = assignArtifactTurnIds(turns, previousManifest);
  const positions = new Map(
    normalizedSessionPayload.messages.map((message, index) => [message.messageUid, index + 1]),
  );
  await mkdir(files.turnsDir, { recursive: true });
  await mkdir(files.turnSnapshotsDir, { recursive: true });
  const readTurnEntries = createTurnEntriesReader({ storageService, sessionDir });
  const committedProjections = [];
  const turnOrder = [];
  for (const turn of artifactTurns) {
    turnOrder.push(
      await writeTurnArtifact({
        readTurnEntries,
        committedProjections,
        sessionDir,
        sessionPayload: normalizedSessionPayload,
        turn: {
          ...turn,
          positions: turn.messages.map((message) => ({
            messageUid: message.messageUid,
            ordinal: positions.get(message.messageUid),
          })),
        },
        previousManifest,
      }),
    );
  }
  await writeSessionManifest({
    storageService,
    files,
    sessionPayload: normalizedSessionPayload,
    layout: { turnArtifactSequence, turnOrder },
    previousManifest,
    atomic,
  });
  for (const publish of committedProjections) publish();
  await pruneSessionArtifacts({ files, previousManifest, turnOrder, fullScan });
  return {
    files,
    session: normalizedSessionPayload,
    listFacts: buildSessionListFacts({
      messageCount: normalizedSessionPayload.messages.length,
      messages: normalizedSessionPayload.messages,
    }),
  };
}

async function writeSessionManifest({
  storageService,
  files,
  sessionPayload,
  layout,
  atomic,
  previousManifest,
}) {
  const manifest = {
    ...sessionPayload,
    artifactEventJournal: await writeSessionArtifactEvents(
      path.dirname(files.session),
      sessionPayload,
      previousManifest,
    ),
    schemaVersion: TURN_JOURNAL_SCHEMA_VERSION,
    messageIdentityVersion: 1,
    turnArtifactSequence: layout.turnArtifactSequence,
    turnOrder: layout.turnOrder,
  };
  delete manifest.messages;
  delete manifest.messageOrder;
  delete manifest.sessionArtifactEvents;
  const storedManifest = await buildStoredCheckpointReceipts({
    storageService,
    sessionDir: path.dirname(files.session),
    session: manifest,
  });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.session,
    payload: storedManifest,
    atomic,
  });
}
