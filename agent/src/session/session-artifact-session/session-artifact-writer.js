/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { mkdir, readdir, rm } from "node:fs/promises";
import { normalizeSessionEntity } from "../entities/session-entity.js";
import {
  buildSessionArtifactFileMap,
  SESSION_ARTIFACT_FILE_NAMES,
} from "../session-artifact-files.js";
import { readOptionalJsonWithStorage, writeJsonWithStorage } from "./artifact-json-io.js";
import { buildSessionListFacts } from "./session-list-facts.js";
import {
  compareTurnPlacement,
  dialogLogicalOrder,
  splitSessionMessages,
} from "./turn-message-partition.js";
import {
  TURN_JOURNAL_SCHEMA_VERSION,
  appendJournal,
  assertCanonicalSessionManifest,
  isTerminalTurn,
  journalPath,
  messageHash,
  readJournalRecords,
  receiptCheckpoint,
  replaceJournal,
  replaceJournalRecords,
  resolveTurnSummaryReceipts,
  SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  summarySnapshotContentHash,
  summarySnapshotIndex,
  turnArtifactRequiresRewrite,
  turnIdOrdinal,
  turnJournalSchemaRequiredError,
  turnKey,
  writeSummarySnapshot,
} from "./turn-journal-store.js";

function ignoreMissingDirectory(error) {
  if (error?.code !== "ENOENT") throw error;
}

export const SESSION_ARTIFACT_PREDECESSOR = Object.freeze({
  CANONICAL: "canonical",
  LEGACY_REWRITE: "legacy_rewrite",
});

const TURN_PLACEMENT = Object.freeze({ RETAINED: "retained", REWRITTEN: "rewritten" });

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
  return assertCanonicalSessionManifest(previousManifest, "Session artifact write");
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
  const artifactTurns = turns.map(({ sourceIndices, ...turn }, index) => {
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

function buildSummarySnapshotPayload({
  sessionPayload,
  turn,
  receipt,
  checkpoint,
  previousCheckpointHash,
  records,
}) {
  return {
    schemaVersion: SUMMARY_SNAPSHOT_SCHEMA_VERSION,
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
  if (compact) {
    return {
      committedBytes: await replaceJournal(file, turn.messages),
      recordCount: turn.messages.length,
    };
  }
  if (snapshotCompactedJournal) {
    return { committedBytes: await replaceJournalRecords(file, []), recordCount: 0 };
  }
  return {
    committedBytes: await appendJournal(file, records, previous ? previous.committedBytes : 0),
    recordCount: (previous ? previous.recordCount : 0) + records.length,
  };
}

async function writeTurnArtifact({ sessionDir, sessionPayload, turn, previousManifest }) {
  const previous = previousManifest?.turnOrder.find((item) => item.turnId === turn.turnId);
  const file = journalPath(sessionDir, turn.turnId);
  const previousHashes = previous ? previous.messageHashes : {};
  const { nextHashes, records } = diffTurnMessages(turn.messages, previousHashes);
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
  const { committedBytes, recordCount } = await commitTurnJournal({
    file,
    turn,
    previous,
    records,
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
    summarySnapshots,
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

function collectReferencedSnapshots(turnOrder) {
  return new Set(
    turnOrder.flatMap((turn) => turn.summarySnapshots.map((snapshot) => snapshot.file)),
  );
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

async function pruneUnreferencedSnapshots(files, turnOrder) {
  const referencedSnapshots = collectReferencedSnapshots(turnOrder);
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
  storageService,
  sessionDir,
  sessionPayload,
  atomic,
  now,
  predecessor,
}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  const normalizedSessionPayload = normalizeSessionEntity(sessionPayload, { now });
  const { turns } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousManifest = await readPreviousTurnManifest({ storageService, files, predecessor });
  const { artifactTurns, turnArtifactSequence } = assignArtifactTurnIds(turns, previousManifest);
  await mkdir(files.turnsDir, { recursive: true });
  await mkdir(files.turnSnapshotsDir, { recursive: true });
  const turnOrder = [];
  for (const turn of artifactTurns) {
    turnOrder.push(
      await writeTurnArtifact({
        sessionDir,
        sessionPayload: normalizedSessionPayload,
        turn,
        previousManifest,
      }),
    );
  }
  const messageOrder = normalizedSessionPayload.messages.map((message) => ({
    messageUid: message.messageUid,
  }));
  await writeSessionManifest({
    storageService,
    files,
    sessionPayload: normalizedSessionPayload,
    layout: { turnArtifactSequence, turnOrder, messageOrder },
    atomic,
  });
  await pruneUnreferencedJournals(files, artifactTurns);
  await pruneUnreferencedSnapshots(files, turnOrder);
  return {
    files,
    session: normalizedSessionPayload,
    listFacts: buildSessionListFacts({
      messageOrder,
      messages: normalizedSessionPayload.messages,
    }),
  };
}

function turnViewError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertTurnViewOwnership({ session, previous, viewScopes, turns }) {
  const outsideItems = previous.turnOrder.filter((item) => !viewScopes.has(item.turnScopeId));
  const outsideOwner = new Map();
  for (const item of outsideItems) {
    if (turnArtifactRequiresRewrite(session, item))
      throw turnViewError(
        `turn view omits a turn that requires rewrite: ${item.turnScopeId}`,
        "SESSION_TURN_VIEW_INCOMPLETE",
      );
    for (const messageUid of item.messageOrder) outsideOwner.set(messageUid, item.turnScopeId);
  }
  const outsideScopes = new Set(outsideItems.map((item) => item.turnScopeId));
  for (const turn of turns) {
    if (outsideScopes.has(turn.turnScopeId))
      throw turnViewError(
        `turn view writes a turn it did not materialize: ${turn.turnScopeId}`,
        "SESSION_TURN_VIEW_INCOMPLETE",
      );
    if (turn.messages.some((message) => outsideOwner.has(message.messageUid)))
      throw turnViewError(
        "messageUid does not belong to the requested dialog and turn",
        "SESSION_MESSAGE_IDENTITY_CONFLICT",
      );
  }
  return outsideItems;
}

function mergeTurnViewMessageOrder({ previous, viewScopes, messages }) {
  const viewUids = new Set(messages.map((message) => message.messageUid));
  const viewOwnedUids = new Set(
    previous.turnOrder
      .filter((item) => viewScopes.has(item.turnScopeId))
      .flatMap((item) => item.messageOrder),
  );
  const kept = previous.messageOrder.filter(
    (reference) => !viewOwnedUids.has(reference.messageUid) || viewUids.has(reference.messageUid),
  );
  const keptUids = new Set(kept.map((reference) => reference.messageUid));
  const appended = messages
    .filter((message) => !keptUids.has(message.messageUid))
    .map((message) => ({ messageUid: message.messageUid }));
  return [...kept, ...appended];
}

function placeTurnViewTurns({ session, outsideItems, turns, messageOrder }) {
  const position = new Map(messageOrder.map((reference, index) => [reference.messageUid, index]));
  const firstSourceIndex = (turnScopeId, uids) => {
    const indices = uids.map((uid) => position.get(uid));
    if (!indices.length || indices.some((index) => index === undefined))
      throw turnViewError(
        `turn messages are not covered by the session message order: ${turnScopeId}`,
        "SESSION_TURN_VIEW_INCOMPLETE",
      );
    return Math.min(...indices);
  };
  const candidates = [
    ...outsideItems.map((item) => ({
      placement: TURN_PLACEMENT.RETAINED,
      turn: item,
      dialogProcessId: item.dialogProcessId,
      firstSourceIndex: firstSourceIndex(item.turnScopeId, item.messageOrder),
    })),
    ...turns.map(({ sourceIndices, ...turn }) => ({
      placement: TURN_PLACEMENT.REWRITTEN,
      turn,
      dialogProcessId: turn.dialogProcessId,
      firstSourceIndex: firstSourceIndex(
        turn.turnScopeId,
        turn.messages.map((message) => message.messageUid),
      ),
    })),
  ];
  return candidates
    .sort((left, right) => left.firstSourceIndex - right.firstSourceIndex)
    .sort(compareTurnPlacement(dialogLogicalOrder(session.dialogOrder)))
    .map(({ placement, turn }) => ({ placement, turn }));
}

export async function writeSessionTurnArtifacts({
  storageService,
  sessionDir,
  sessionPayload,
  turnScopeIds,
  atomic,
  now,
}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = normalizeSessionEntity(sessionPayload, { now });
  const previous = await readPreviousTurnManifest({
    storageService,
    files,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
  });
  if (!previous) throw turnJournalSchemaRequiredError("Session turn view write");
  const viewScopes = new Set(turnScopeIds.map(requireCanonicalTurnScopeId));
  const { turns } = splitSessionMessages(session.messages, session.dialogOrder);
  const outsideItems = assertTurnViewOwnership({ session, previous, viewScopes, turns });
  const messageOrder = mergeTurnViewMessageOrder({
    previous,
    viewScopes,
    messages: session.messages,
  });
  const placed = placeTurnViewTurns({ session, outsideItems, turns, messageOrder });
  const { artifactTurns, turnArtifactSequence } = assignArtifactTurnIds(
    placed.map(({ turn }) => turn),
    previous,
  );
  const turnOrder = [];
  for (const [index, turn] of artifactTurns.entries()) {
    turnOrder.push(
      placed[index].placement === TURN_PLACEMENT.RETAINED
        ? turn
        : await writeTurnArtifact({
            sessionDir,
            sessionPayload: session,
            turn,
            previousManifest: previous,
          }),
    );
  }
  await writeSessionManifest({
    storageService,
    files,
    sessionPayload: session,
    layout: { turnArtifactSequence, turnOrder, messageOrder },
    atomic,
  });
  await pruneUnreferencedJournals(files, artifactTurns);
  await pruneUnreferencedSnapshots(files, turnOrder);
  return {
    files,
    session,
    listFacts: buildSessionListFacts({ messageOrder, messages: session.messages }),
  };
}

async function writeSessionManifest({ storageService, files, sessionPayload, layout, atomic }) {
  const manifest = {
    ...sessionPayload,
    schemaVersion: TURN_JOURNAL_SCHEMA_VERSION,
    messageIdentityVersion: 1,
    turnArtifactSequence: layout.turnArtifactSequence,
    turnOrder: layout.turnOrder,
    messageOrder: layout.messageOrder,
  };
  delete manifest.messages;
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.session,
    payload: manifest,
    atomic,
  });
}
