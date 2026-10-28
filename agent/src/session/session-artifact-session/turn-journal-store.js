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
import { createHash } from "node:crypto";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { SESSION_ARTIFACT_FILE_NAMES } from "../session-artifact-files.js";
import { text } from "@noobot/shared/value";

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

function assertIncrementalJournalRecords(records, file) {
  for (const record of records) {
    const uid = text(record?.messageUid);
    const validRemove = record?.op === "remove" && uid;
    const validUpsert =
      record?.op === "upsert" &&
      uid &&
      record.message &&
      typeof record.message === "object" &&
      text(record.message.messageUid) === uid &&
      record.hash === messageHash(record.message);
    if (!validRemove && !validUpsert) {
      const error = new Error(`turn journal contains an invalid incremental record: ${file}`);
      error.code = "SESSION_TURN_JOURNAL_RECORD_INVALID";
      throw error;
    }
  }
}

export function turnKey(turn = {}) {
  return text(turn.turnScopeId);
}

export function turnIdOrdinal(turnId = "") {
  const match = /^turn-(\d+)$/.exec(text(turnId));
  return match ? Number(match[1]) : 0;
}

export function isTerminalTurn(session, turn) {
  const scope = text(turn?.turnScopeId);
  const dialog = text(turn?.dialogProcessId);
  const lifecycleTurn = session?.turnLifecycle?.turns?.[scope];
  if (!lifecycleTurn || text(lifecycleTurn.dialogProcessId) !== dialog) return false;
  return Boolean(lifecycleTurn.terminalStatus);
}

export function resolveTurnSummaryReceipts(session = {}, turn = {}) {
  const state = session?.turnSummaryCheckpoints?.[text(turn?.turnScopeId)];
  return Array.isArray(state?.receipts) ? state.receipts : [];
}

export function receiptCheckpoint(receipt, previousCheckpointIds) {
  const checkpointId = text(receipt?.checkpointId);
  const checkpointRevision = Number(receipt?.checkpointRevision || 0);
  const valid =
    checkpointId &&
    Number.isInteger(checkpointRevision) &&
    checkpointRevision >= 1 &&
    !previousCheckpointIds.has(checkpointId);
  return valid ? { checkpointId, checkpointRevision } : null;
}

export function turnArtifactRequiresRewrite(session, item) {
  const snapshots = item.summarySnapshots;
  const checkpointIds = new Set(snapshots.map((snapshot) => text(snapshot?.checkpointId)));
  if (
    resolveTurnSummaryReceipts(session, item).some((receipt) =>
      receiptCheckpoint(receipt, checkpointIds),
    )
  )
    return true;
  return isTerminalTurn(session, item) && item.compacted !== true && snapshots.length === 0;
}

export function summarySnapshotIndex(receipt = {}, file = "", contentHash = "") {
  return {
    checkpointId: text(receipt?.checkpointId),
    checkpointRevision: Number(receipt?.checkpointRevision || 0),
    file,
    contentHash,
    messageUids: Array.isArray(receipt?.summarizedMessageUids)
      ? receipt.summarizedMessageUids.map((uid) => text(uid)).filter(Boolean)
      : [],
    committedAt: text(receipt?.committedAt),
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
