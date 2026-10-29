/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
  assertSessionManifestLayout,
} from "@noobot/session-protocol";
import { SESSION_REPAIR_ERROR_CODE, assertTurnJournalBoundary } from "@noobot/session-repair";
import { readTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { createHash } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

export const TURN_JOURNAL_SCHEMA_VERSION = SESSION_ARTIFACT_SCHEMA_VERSION;
export const SUMMARY_SNAPSHOT_SCHEMA_VERSION = 2;

export function turnJournalSchemaRequiredError(operation) {
  const error = new Error(`${operation} requires the canonical turn journal schema`);
  error.code = SESSION_ERROR_CODE.TURN_JOURNAL_SCHEMA_REQUIRED;
  return error;
}

export function assertCanonicalSessionManifest(session, operation) {
  if (session.schemaVersion !== TURN_JOURNAL_SCHEMA_VERSION) {
    throw turnJournalSchemaRequiredError(operation);
  }
  return assertSessionManifestLayout(session);
}

export function journalPath(sessionDir, turnId) {
  return path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir, `${turnId}.jsonl`);
}

export function summarySnapshotContentHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

export function messageHash(message) {
  return `sha256:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`;
}

export function assertIncrementalJournalRecords(records, file) {
  for (const record of records) {
    const valid =
      isPlainObject(record) &&
      isCanonicalText(record.messageUid) &&
      (record.op === "remove" ||
        (record.op === "upsert" &&
          isPlainObject(record.message) &&
          record.message.messageUid === record.messageUid &&
          record.hash === messageHash(record.message)));
    if (!valid) {
      const error = new Error(`turn journal contains an invalid incremental record: ${file}`);
      error.code = "SESSION_TURN_JOURNAL_RECORD_INVALID";
      throw error;
    }
  }
}

export function turnKey(turn) {
  return turn.turnScopeId;
}

export function turnIdOrdinal(turnId) {
  const match = /^turn-(\d+)$/.exec(turnId);
  return match ? Number(match[1]) : 0;
}

export function isTerminalTurn(session, turn) {
  const lifecycleTurn = session.turnLifecycle.turns[turn.turnScopeId];
  if (!lifecycleTurn || lifecycleTurn.dialogProcessId !== turn.dialogProcessId) return false;
  return Boolean(lifecycleTurn.terminalStatus);
}

export function resolveTurnSummaryReceipts(session, turn) {
  return readTurnSummaryCheckpointState(session, {
    dialogProcessId: turn.dialogProcessId,
    turnScopeId: turn.turnScopeId,
  }).receipts;
}

export function receiptCheckpoint(receipt, previousCheckpointIds) {
  if (previousCheckpointIds.has(receipt.checkpointId)) return null;
  return { checkpointId: receipt.checkpointId, checkpointRevision: receipt.checkpointRevision };
}

export function turnArtifactRequiresRewrite(session, item) {
  const snapshots = item.summarySnapshots;
  const checkpointIds = new Set(snapshots.map((snapshot) => snapshot.checkpointId));
  if (
    resolveTurnSummaryReceipts(session, item).some((receipt) =>
      receiptCheckpoint(receipt, checkpointIds),
    )
  )
    return true;
  return isTerminalTurn(session, item) && item.compacted !== true && snapshots.length === 0;
}

export function summarySnapshotIndex(receipt, file, contentHash) {
  return {
    checkpointId: receipt.checkpointId,
    checkpointRevision: receipt.checkpointRevision,
    file,
    contentHash,
    messageUids: [...receipt.summarizedMessageUids],
    committedAt: receipt.committedAt,
  };
}

export async function writeSummarySnapshot(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

function parseJournalRecords(file, raw) {
  const records = [];
  for (const line of raw.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const failure = new Error(`turn journal is corrupted: ${file}`);
      failure.code = SESSION_REPAIR_ERROR_CODE.ARTIFACT_JSON_CORRUPTED;
      failure.cause = error;
      throw failure;
    }
  }
  assertIncrementalJournalRecords(records, file);
  return records;
}

async function openCommittedJournal(file, committedBytes) {
  try {
    return await open(file, "r");
  } catch (error) {
    if (error?.code === "ENOENT" && committedBytes === 0) return null;
    if (error?.code === "ENOENT") {
      const failure = new Error(`session turn journal is missing: ${file}`);
      failure.code = SESSION_REPAIR_ERROR_CODE.TURN_ARTIFACT_MISSING;
      throw failure;
    }
    throw error;
  }
}

export async function readJournalRecordRange(file, committedBytes, resume = null) {
  const handle = await openCommittedJournal(file, committedBytes);
  if (!handle) return { identity: "", resumed: false, records: [] };
  try {
    const info = await handle.stat({ bigint: true });
    const identity = `${info.dev}:${info.ino}`;
    const limit = assertTurnJournalBoundary(file, Number(info.size), committedBytes);
    const resumed =
      resume !== null && resume.identity === identity && resume.committedBytes <= limit;
    const fromBytes = resumed ? resume.committedBytes : 0;
    const raw = Buffer.alloc(limit - fromBytes);
    let offset = 0;
    while (offset < raw.length) {
      const { bytesRead } = await handle.read(raw, offset, raw.length - offset, fromBytes + offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    assertTurnJournalBoundary(file, fromBytes + offset, committedBytes);
    return { identity, resumed, records: parseJournalRecords(file, raw) };
  } finally {
    await handle.close();
  }
}

export async function readJournalRecords(file, committedBytes) {
  return (await readJournalRecordRange(file, committedBytes)).records;
}

export async function appendJournal(file, records, committedBytes = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "a+");
  try {
    const currentSize = (await handle.stat()).size;
    const committed = assertTurnJournalBoundary(file, currentSize, committedBytes);
    if (currentSize !== committed) await handle.truncate(committed);
    if (!records.length) return committed;
    const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    return committed + Buffer.byteLength(payload, "utf8");
  } finally {
    await handle.close();
  }
}

export async function replaceJournalRecords(file, records) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  return Buffer.byteLength(payload, "utf8");
}

export async function replaceJournal(file, messages) {
  return replaceJournalRecords(
    file,
    messages.map((message) => ({
      op: "upsert",
      messageUid: message.messageUid,
      message,
      hash: messageHash(message),
    })),
  );
}
