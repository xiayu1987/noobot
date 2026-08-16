/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  readJsonArtifactFile,
} from "../session-artifact-files.js";

export const TURN_JOURNAL_SCHEMA_VERSION = TURN_THRESHOLDS.session.turnJournalSchemaVersion;

export function journalPath(sessionDir, turnId) {
  return path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir, `${turnId}.jsonl`);
}

function resolveSummarySnapshotPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const snapshotsRoot = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (
    !reference ||
    path.isAbsolute(reference) ||
    reference.includes("\0") ||
    normalized === "." ||
    normalized.startsWith(`..${path.sep}`) ||
    (resolved !== snapshotsRoot && !resolved.startsWith(`${snapshotsRoot}${path.sep}`)) ||
    path.extname(resolved) !== ".json"
  ) {
    const error = new Error(`invalid session summary snapshot reference: ${reference}`);
    error.code = "SESSION_SUMMARY_SNAPSHOT_PATH_INVALID";
    throw error;
  }
  return resolved;
}

export function messageHash(message) {
  return `sha256:${createHash("sha256").update(JSON.stringify(message)).digest("hex")}`;
}

function assertIncrementalJournalRecords(records, file) {
  for (const record of records) {
    const uid = String(record?.messageUid || "").trim();
    const validRemove = record?.op === "remove" && uid;
    const validUpsert =
      record?.op === "upsert" &&
      uid &&
      record.message &&
      typeof record.message === "object" &&
      String(record.message.messageUid || "").trim() === uid &&
      record.hash === messageHash(record.message);
    if (!validRemove && !validUpsert) {
      const error = new Error(`summary snapshot contains an invalid incremental record: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_RECORD_INVALID";
      throw error;
    }
  }
}

export function turnKey(turn = {}) {
  return String(turn.turnScopeId || "").trim();
}

export function turnIdOrdinal(turnId = "") {
  const match = /^turn-(\d+)$/.exec(String(turnId || "").trim());
  return match ? Number(match[1]) : 0;
}

export function isTerminalTurn(session, turn) {
  const scope = String(turn?.turnScopeId || "").trim();
  const dialog = String(turn?.dialogProcessId || "").trim();
  const statuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  return statuses.some(
    (item) =>
      String(item?.turnScopeId || "").trim() === scope &&
      (!dialog ||
        !String(item?.dialogProcessId || "").trim() ||
        String(item.dialogProcessId).trim() === dialog) &&
      ["completed", "user_stopped", "timeout", "failed", "error"].includes(
        String(item?.status || "")
          .trim()
          .toLowerCase(),
      ),
  );
}

export function resolveTurnSummaryReceipts(session = {}, turn = {}) {
  const state = session?.turnSummaryCheckpoints?.[String(turn?.turnScopeId || "").trim()];
  return Array.isArray(state?.receipts) ? state.receipts : [];
}

export function summarySnapshotRecord(receipt = {}, turn = {}, file = "", contentHash = "") {
  return {
    op: "summary_snapshot",
    checkpointId: String(receipt?.checkpointId || "").trim(),
    checkpointRevision: Number(receipt?.checkpointRevision || 0),
    turnScopeId: String(turn?.turnScopeId || "").trim(),
    dialogProcessId: String(turn?.dialogProcessId || "").trim(),
    file,
    contentHash,
    messageUids: Array.isArray(receipt?.summarizedMessageUids)
      ? receipt.summarizedMessageUids.map((uid) => String(uid || "").trim()).filter(Boolean)
      : [],
    committedAt: String(receipt?.committedAt || "").trim(),
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
    const file = String(record?.file || "").trim();
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
      .map((message) => [String(message?.messageUid || "").trim(), message])
      .filter(([uid]) => uid),
  );
  for (const record of records) {
    const uid = String(record?.messageUid || "").trim();
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && record.message && typeof record.message === "object")
      byUid.set(uid, record.message);
  }
  const ordered = (Array.isArray(order) ? order : [])
    .map((uid) => byUid.get(String(uid || "").trim()))
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
  let currentSize = 0;
  try {
    currentSize = (await stat(file)).size;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const committed = Math.max(0, Math.min(currentSize, Number(committedBytes) || 0));
  if (currentSize !== committed) await truncate(file, committed);
  if (!records.length) return committed;
  const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  const handle = await open(file, "a");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return committed + Buffer.byteLength(payload, "utf8");
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
