/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path, resolveScopedArtifactPath } from "@noobot/path-resolver";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { SESSION_ARTIFACT_FILE_NAMES, readJsonArtifactFile } from "../session-artifact-files.js";
import { text } from "@noobot/shared/value";

export const TURN_JOURNAL_SCHEMA_VERSION = SESSION_ARTIFACT_SCHEMA_VERSION;

export function journalPath(sessionDir, turnId) {
  return path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir, `${turnId}.jsonl`);
}

function resolveSummarySnapshotPath(sessionDir = "", file = "") {
  return resolveScopedArtifactPath({
    baseDir: sessionDir,
    reference: file,
    scopeDir: SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
    extensions: [".json"],
    errorCode: "SESSION_SUMMARY_SNAPSHOT_PATH_INVALID",
    errorLabel: "session summary snapshot reference",
  });
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
      const error = new Error(`summary snapshot contains an invalid incremental record: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_RECORD_INVALID";
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

export function summarySnapshotRecord(receipt = {}, turn = {}, file = "", contentHash = "") {
  return {
    op: "summary_snapshot",
    checkpointId: text(receipt?.checkpointId),
    checkpointRevision: Number(receipt?.checkpointRevision || 0),
    turnScopeId: text(turn?.turnScopeId),
    dialogProcessId: text(turn?.dialogProcessId),
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

export function collectSummarySnapshotRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record?.op === "summary_snapshot",
  );
}

export async function readSummarySnapshots(sessionDir, records = []) {
  const snapshots = [];
  let previousCheckpointHash = "";
  for (const record of collectSummarySnapshotRecords(records)) {
    const file = text(record?.file);
    const payload = await readJsonArtifactFile(resolveSummarySnapshotPath(sessionDir, file), null);
    if (
      !payload ||
      Number(payload.schemaVersion) !== 2 ||
      !Array.isArray(payload.records) ||
      Object.hasOwn(payload, "messages") ||
      payload.previousCheckpointHash !== previousCheckpointHash ||
      payload.checkpointId !== record.checkpointId ||
      payload.checkpointRevision !== record.checkpointRevision
    ) {
      const error = new Error(`summary snapshot does not match its journal index: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH";
      throw error;
    }
    const contentHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")}`;
    if (contentHash !== record.contentHash) {
      const error = new Error(`summary snapshot hash mismatch: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH";
      throw error;
    }
    assertIncrementalJournalRecords(payload.records, file);
    snapshots.push({ ...record, payload });
    previousCheckpointHash = record.contentHash;
  }
  return snapshots;
}

export async function readJournalRecords(file, committedBytes) {
  let raw;
  try {
    raw = await readFile(file);
  } catch (error) {
    if (error?.code === "ENOENT" && Number(committedBytes || 0) === 0) return [];
    if (error?.code === "ENOENT") {
      const failure = new Error(`session turn journal is missing: ${file}`);
      failure.code = "SESSION_TURN_ARTIFACT_MISSING";
      throw failure;
    }
    throw error;
  }
  const limit = Math.max(0, Math.min(raw.length, Number(committedBytes) || 0));
  const records = [];
  for (const line of raw.subarray(0, limit).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const failure = new Error(`turn journal is corrupted: ${file}`);
      failure.code = "ARTIFACT_JSON_CORRUPTED";
      failure.cause = error;
      throw failure;
    }
  }
  assertIncrementalJournalRecords(
    records.filter((record) => record?.op !== "summary_snapshot"),
    file,
  );
  return records;
}

function materializeJournal(records, order = [], baseMessages = []) {
  const byUid = new Map(
    (Array.isArray(baseMessages) ? baseMessages : [])
      .map((message) => [text(message?.messageUid), message])
      .filter(([uid]) => uid),
  );
  for (const record of records) {
    const uid = text(record?.messageUid);
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && record.message && typeof record.message === "object")
      byUid.set(uid, record.message);
  }
  const ordered = (Array.isArray(order) ? order : [])
    .map((uid) => byUid.get(text(uid)))
    .filter(Boolean);
  const remaining = [...byUid.entries()]
    .filter(([uid]) => !order.includes(uid))
    .map(([, message]) => message);
  return [...ordered, ...remaining];
}

export function materializeTurnJournal(records, order, summarySnapshots) {
  const checkpointRecords = summarySnapshots.flatMap((snapshot) => snapshot.payload.records);
  return materializeJournal([...checkpointRecords, ...records], order);
}

export async function appendJournal(file, records, committedBytes = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, "a+");
  try {
    const currentSize = (await handle.stat()).size;
    const committed = Math.max(0, Math.min(currentSize, Number(committedBytes) || 0));
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

export async function replaceJournal(file, messages, summaryRecords = []) {
  return replaceJournalRecords(file, [
    ...messages.map((message) => ({
      op: "upsert",
      messageUid: message.messageUid,
      message,
      hash: messageHash(message),
    })),
    ...summaryRecords,
  ]);
}
