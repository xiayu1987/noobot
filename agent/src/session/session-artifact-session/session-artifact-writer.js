/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ARTIFACT_SUMMARY_SNAPSHOT_SCHEMA_VERSION,
  createSessionStorageMessageIndex,
} from "@noobot/session-protocol";
import { requireCanonicalTurnScopeId } from "@noobot/session-protocol/turn-scope-identity";
import { mkdir, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import { forgetVerifiedSnapshot, getTurnMaterializer } from "./turn-materializer.js";
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
  resolveTurnJournalPath,
  resolveTurnSummaryReceipts,
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
  const canonical = assertCanonicalSessionManifest(previousManifest, "Session artifact write");
  await materializeCommittedTurnEvents(path.dirname(files.session), canonical.turnLifecycle);
  return canonical;
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
  storageService,
  sessionDir,
  sessionPayload,
  turn,
  previousManifest,
}) {
  const previous = previousManifest?.turnOrder.find((item) => item.turnId === turn.turnId);
  const file = previous
    ? resolveTurnJournalPath(sessionDir, previous.file)
    : journalPath(sessionDir, turn.turnId);
  const previousEntries = previous
    ? await getTurnMaterializer().materializeEntries({ storageService, sessionDir, item: previous })
    : [];
  const previousHashes = Object.fromEntries(
    previousEntries.map(({ message, hash }) => [message.messageUid, hash]),
  );
  const { nextHashes, records } = diffTurnMessages(turn.messages, previousHashes);
  const previousPositions = previousEntries.map(({ message, ordinal }) => ({
    messageUid: message.messageUid,
    ordinal,
  }));
  if (JSON.stringify(previousPositions) !== JSON.stringify(turn.positions))
    records.push({ op: "order", positions: turn.positions });
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
  return {
    turnId: turn.turnId,
    artifactOrdinal: turn.artifactOrdinal,
    turnScopeId: turn.turnScopeId,
    dialogProcessId: turn.dialogProcessId,
    file: path.relative(sessionDir, committedFile).replaceAll("\\", "/"),
    committedBytes,
    recordCount,
    ...createSessionStorageMessageIndex(
      turn.messages.map((message, index) => ({
        message,
        ordinal: turn.positions[index].ordinal,
        hash: nextHashes[message.messageUid],
      })),
    ),
    summarySnapshots,
    compacted: compact || previous?.compacted === true,
  };
}

function isJournalFileName(name) {
  return name.endsWith(".json") || name.endsWith(".jsonl");
}

async function pruneUnreferencedJournals(files, artifactTurns) {
  const referenced = new Set(artifactTurns.map((turn) => path.basename(turn.file)));
  try {
    const entries = await readdir(files.turnsDir, { withFileTypes: true });
    const unreferenced = entries.filter(
      (entry) => entry.isFile() && isJournalFileName(entry.name) && !referenced.has(entry.name),
    );
    for (const entry of unreferenced)
      await rm(path.join(files.turnsDir, entry.name), { force: true });
  } catch (error) {
    ignoreMissingDirectory(error);
  }
}

function collectReferencedSnapshots(turnOrder) {
  return new Set(
    turnOrder.flatMap((turn) => turn.summarySnapshots.map((snapshot) => snapshot.file)),
  );
}

async function pruneTurnSnapshotDir({ sessionDir, turnDir, turnDirName, referencedSnapshots }) {
  for (const entry of await readdir(turnDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const relative = path
      .join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnDirName, entry.name)
      .replaceAll("\\", "/");
    if (referencedSnapshots.has(relative)) continue;
    await rm(path.join(turnDir, entry.name), { force: true });
    forgetVerifiedSnapshot(sessionDir, relative);
  }
}

async function pruneUnreferencedSnapshots(files, turnOrder) {
  const referencedSnapshots = collectReferencedSnapshots(turnOrder);
  const sessionDir = path.dirname(files.session);
  try {
    for (const turnEntry of await readdir(files.turnSnapshotsDir, { withFileTypes: true })) {
      if (!turnEntry.isDirectory()) continue;
      const turnDir = path.join(files.turnSnapshotsDir, turnEntry.name);
      await pruneTurnSnapshotDir({
        sessionDir,
        turnDir,
        turnDirName: turnEntry.name,
        referencedSnapshots,
      });
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
  const { artifactTurns, turnArtifactSequence } = assignArtifactTurnIds(turns, previousManifest);
  const positions = new Map(
    normalizedSessionPayload.messages.map((message, index) => [message.messageUid, index + 1]),
  );
  await mkdir(files.turnsDir, { recursive: true });
  await mkdir(files.turnSnapshotsDir, { recursive: true });
  const turnOrder = [];
  for (const turn of artifactTurns) {
    turnOrder.push(
      await writeTurnArtifact({
        storageService,
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
  await pruneUnreferencedJournals(files, turnOrder);
  await pruneUnreferencedSnapshots(files, turnOrder);
  return {
    files,
    session: normalizedSessionPayload,
    listFacts: buildSessionListFacts({
      messageCount: normalizedSessionPayload.messages.length,
      messages: normalizedSessionPayload.messages,
    }),
  };
}

function turnViewError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function assertTurnViewOwnership({
  storageService,
  sessionDir,
  session,
  previous,
  viewScopes,
  turns,
}) {
  const outsideItems = previous.turnOrder.filter((item) => !viewScopes.has(item.turnScopeId));
  const outsideOwner = new Map();
  for (const item of outsideItems) {
    if (turnArtifactRequiresRewrite(session, item))
      throw turnViewError(
        `turn view omits a turn that requires rewrite: ${item.turnScopeId}`,
        "SESSION_TURN_VIEW_INCOMPLETE",
      );
    const entries = await getTurnMaterializer().materializeEntries({
      storageService,
      sessionDir,
      item,
    });
    for (const { message } of entries) outsideOwner.set(message.messageUid, item.turnScopeId);
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

async function mergeTurnViewPositions({
  storageService,
  sessionDir,
  previous,
  viewScopes,
  messages,
}) {
  const positions = new Map();
  for (const item of previous.turnOrder.filter((turn) => viewScopes.has(turn.turnScopeId))) {
    const entries = await getTurnMaterializer().materializeEntries({
      storageService,
      sessionDir,
      item,
    });
    for (const { message, ordinal } of entries) positions.set(message.messageUid, ordinal);
  }
  let nextOrdinal = Math.max(0, ...previous.turnOrder.map((turn) => turn.lastMessageOrdinal));
  for (const message of messages) {
    if (!positions.has(message.messageUid)) positions.set(message.messageUid, ++nextOrdinal);
  }
  return positions;
}

function placeTurnViewTurns({ session, outsideItems, turns, position }) {
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
      firstSourceIndex: item.firstMessageOrdinal,
    })),
    ...turns.map(({ sourceIndices, ...turn }) => ({
      placement: TURN_PLACEMENT.REWRITTEN,
      turn: {
        ...turn,
        positions: turn.messages.map((message) => ({
          messageUid: message.messageUid,
          ordinal: position.get(message.messageUid),
        })),
      },
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
}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = normalizeSessionEntity(sessionPayload);
  const previous = await readPreviousTurnManifest({
    storageService,
    files,
    predecessor: SESSION_ARTIFACT_PREDECESSOR.CANONICAL,
  });
  if (!previous) throw turnJournalSchemaRequiredError("Session turn view write");
  const viewScopes = new Set(turnScopeIds.map(requireCanonicalTurnScopeId));
  const { turns } = splitSessionMessages(session.messages, session.dialogOrder);
  const outsideItems = await assertTurnViewOwnership({
    storageService,
    sessionDir,
    session,
    previous,
    viewScopes,
    turns,
  });
  const position = await mergeTurnViewPositions({
    storageService,
    sessionDir,
    previous,
    viewScopes,
    messages: session.messages,
  });
  const placed = placeTurnViewTurns({ session, outsideItems, turns, position });
  const orderedMessages = [...session.messages].sort(
    (left, right) => position.get(left.messageUid) - position.get(right.messageUid),
  );
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
            storageService,
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
    layout: { turnArtifactSequence, turnOrder },
    previousManifest: previous,
    atomic,
  });
  await pruneUnreferencedJournals(files, turnOrder);
  await pruneUnreferencedSnapshots(files, turnOrder);
  return {
    files,
    session,
    listFacts: buildSessionListFacts({
      messages: orderedMessages,
      messageCount: turnOrder.reduce((count, turn) => count + turn.messageCount, 0),
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
