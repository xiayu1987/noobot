/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../shared/utils/path-resolver.js";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, truncate, writeFile } from "node:fs/promises";
import { buildSessionDisplaySummary, isSessionDisplaySummaryPayload } from "./session-summary-builders.js";
import { assertSessionMessageIdentityInvariants, normalizeSessionEntity } from "./entities/session-entity.js";
import { resolveMessageDialogProcessId } from "../context/session/dialog-process-id-resolver.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { buildSessionArtifactFileMap, SESSION_ARTIFACT_FILE_NAMES, assertArtifactSessionWritable, readJsonArtifactFile, writeJsonArtifactFile } from "./session-artifact-files.js";
import { appendRollingJsonlArtifactLog } from "./session-artifact-execution-logs.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

function splitSessionMessages(messages = [], dialogOrder = []) {
  const source = Array.isArray(messages) ? messages : [];
  const logicalOrder = new Map(
    (Array.isArray(dialogOrder) ? dialogOrder : []).map((entry, index) => [
      String(entry?.dialogProcessId || "").trim(),
      Number(entry?.dialogOrdinal) || index + 1,
    ]),
  );
  const buckets = new Map();
  source.forEach((message, sourceIndex) => {
    const dialogProcessId = resolveMessageDialogProcessId(message);
    const turnScopeId = String(message?.turnScopeId || "").trim();
    if (!turnScopeId || !dialogProcessId) {
      const error = new TypeError(`session message is missing Turn identity at index ${sourceIndex}`);
      error.code = "SESSION_TURN_IDENTITY_REQUIRED";
      throw error;
    }
    const key = `turn:${turnScopeId}`;
    const bucket = buckets.get(key) || {
      dialogProcessId,
      turnScopeId,
      firstSourceIndex: sourceIndex,
      messages: [],
      sourceIndices: [],
    };
    if (bucket.dialogProcessId !== dialogProcessId) {
      const error = new TypeError(`turnScopeId ${turnScopeId} maps to multiple dialogProcessId values`);
      error.code = "SESSION_TURN_IDENTITY_CONFLICT";
      throw error;
    }
    bucket.messages.push(message);
    bucket.sourceIndices.push(sourceIndex);
    buckets.set(key, bucket);
  });
  const ordered = [...buckets.values()].sort((left, right) => {
    const leftDialogOrdinal = logicalOrder.get(left.dialogProcessId);
    const rightDialogOrdinal = logicalOrder.get(right.dialogProcessId);
    if (Number.isFinite(leftDialogOrdinal) && Number.isFinite(rightDialogOrdinal)) return leftDialogOrdinal - rightDialogOrdinal;
    if (Number.isFinite(leftDialogOrdinal) !== Number.isFinite(rightDialogOrdinal)) return Number.isFinite(leftDialogOrdinal) ? -1 : 1;
    return left.firstSourceIndex - right.firstSourceIndex;
  });
  const turns = ordered.map((bucket, index) => {
    const artifactOrdinal = index + 1;
    return {
      turnId: `turn-${String(artifactOrdinal).padStart(6, "0")}`,
      artifactOrdinal,
      turnScopeId: bucket.turnScopeId,
      dialogProcessId: bucket.dialogProcessId,
      messages: bucket.messages,
      sourceIndices: bucket.sourceIndices,
    };
  });
  const locationBySourceIndex = new Map();
  for (const turn of turns) {
    turn.sourceIndices.forEach((sourceIndex, messageIndex) => {
      locationBySourceIndex.set(sourceIndex, { turnId: turn.turnId, messageIndex });
    });
  }
  const messageOrder = source.map((_, sourceIndex) => {
    const location = locationBySourceIndex.get(sourceIndex);
    return {
      turnId: location.turnId,
      messageIndex: location.messageIndex,
    };
  });
  return { turns, messageOrder };
}

export function resolveTurnArtifactPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const turnsRoot = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (!reference || path.isAbsolute(reference) || reference.includes("\0")
    || normalized === "." || normalized.startsWith(`..${path.sep}`)
    || (resolved !== turnsRoot && !resolved.startsWith(`${turnsRoot}${path.sep}`))
    || ![".json", ".jsonl"].includes(path.extname(resolved))) {
    const error = new Error(`invalid session turn artifact reference: ${reference}`);
    error.code = "SESSION_TURN_ARTIFACT_PATH_INVALID";
    throw error;
  }
  return resolved;
}

const TURN_JOURNAL_SCHEMA_VERSION = TURN_THRESHOLDS.session.turnJournalSchemaVersion;

function journalPath(sessionDir, turnId) {
  return path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir, `${turnId}.jsonl`);
}

function resolveSummarySnapshotPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const snapshotsRoot = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (!reference || path.isAbsolute(reference) || reference.includes("\0")
    || normalized === "." || normalized.startsWith(`..${path.sep}`)
    || (resolved !== snapshotsRoot && !resolved.startsWith(`${snapshotsRoot}${path.sep}`))
    || path.extname(resolved) !== ".json") {
    const error = new Error(`invalid session summary snapshot reference: ${reference}`);
    error.code = "SESSION_SUMMARY_SNAPSHOT_PATH_INVALID";
    throw error;
  }
  return resolved;
}

function resolveSummaryDetailPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const root = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (!reference || path.isAbsolute(reference) || reference.includes("\0") || normalized === "."
    || normalized.startsWith(`..${path.sep}`)
    || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))
    || path.extname(resolved) !== ".json") {
    const error = new Error(`invalid session summary detail reference: ${reference}`);
    error.code = "SESSION_SUMMARY_DETAIL_PATH_INVALID";
    throw error;
  }
  return resolved;
}

function summaryDetailHash(payload) {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}

async function writeSessionSummaryDetails({ storageService, sessionDir, summaryPayload }) {
  const detailsDir = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir);
  await mkdir(detailsDir, { recursive: true });
  const referenced = new Set();
  const messages = [];
  for (const message of (Array.isArray(summaryPayload?.messages) ? summaryPayload.messages : [])) {
    const toolTimeline = Array.isArray(message?.toolTimeline) ? message.toolTimeline : [];
    const activityTimeline = Array.isArray(message?.activityTimeline) ? message.activityTimeline : [];
    if (!toolTimeline.length && !activityTimeline.length) { messages.push(message); continue; }
    const presentationMessageId = String(message?.presentationMessageId || message?.messageId || message?.id || "").trim();
    if (!presentationMessageId) throw new TypeError("summary detail requires presentation message identity");
    const detail = { schemaVersion: 1, presentationMessageId, toolTimeline, activityTimeline };
    const filename = `${encodeURIComponent(presentationMessageId)}.json`;
    const relative = `${SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir}/${filename}`;
    referenced.add(relative);
    const detailPath = resolveSummaryDetailPath(sessionDir, relative);
    await writeJsonWithStorage({ storageService, artifactPath: detailPath, payload: detail, atomic: true });
    const { toolTimeline: _tool, activityTimeline: _activity, ...light } = message;
    const thinkingDetailCount = toolTimeline.length + activityTimeline.length;
    messages.push({
      ...light,
      hasThinkingDetails: true,
      thinkingDetailCount,
      thinkingDetailRef: { file: relative, contentHash: summaryDetailHash(detail) },
    });
  }
  summaryPayload.messages = messages;
  for (const entry of await readdir(detailsDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      const relative = `${SESSION_ARTIFACT_FILE_NAMES.sessionSummaryDetailsDir}/${entry.name}`;
      if (!referenced.has(relative)) await rm(path.join(detailsDir, entry.name), { force: true });
    }
  }
  return summaryPayload;
}

async function hydrateSessionSummaryDetails({ storageService, sessionDir, payload }) {
  const messages = (Array.isArray(payload?.messages) ? payload.messages : []).map(async (message) => {
    const ref = message?.thinkingDetailRef;
    if (!ref || typeof ref !== "object") return message;
    const detailPath = resolveSummaryDetailPath(sessionDir, ref.file);
    const detail = await readJsonWithStorage({ storageService, artifactPath: detailPath, fallback: null });
    if (!detail || detail.presentationMessageId !== String(message?.presentationMessageId || message?.messageId || message?.id || "")
      || summaryDetailHash(detail) !== ref.contentHash) {
      const error = new Error(`session summary detail does not match its reference: ${ref.file}`);
      error.code = "SESSION_SUMMARY_DETAIL_REFERENCE_MISMATCH";
      throw error;
    }
    return { ...message, toolTimeline: detail.toolTimeline, activityTimeline: detail.activityTimeline };
  });
  return { ...payload, messages: await Promise.all(messages) };
}

function messageHash(message) {
  const canonical = JSON.stringify(message);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function turnKey(turn = {}) {
  return String(turn.turnScopeId || "").trim();
}

function turnIdOrdinal(turnId = "") {
  const match = /^turn-(\d+)$/.exec(String(turnId || "").trim());
  return match ? Number(match[1]) : 0;
}

function isTerminalTurn(session, turn) {
  const scope = String(turn?.turnScopeId || "").trim();
  const dialog = String(turn?.dialogProcessId || "").trim();
  const statuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  return statuses.some((item) => String(item?.turnScopeId || "").trim() === scope
    && (!dialog || !String(item?.dialogProcessId || "").trim() || String(item.dialogProcessId).trim() === dialog)
    && ["completed", "user_stopped", "timeout", "failed", "error"].includes(String(item?.status || "").trim().toLowerCase()));
}

function resolveTurnSummaryReceipts(session = {}, turn = {}) {
  const state = session?.turnSummaryCheckpoints?.[String(turn?.turnScopeId || "").trim()];
  return Array.isArray(state?.receipts) ? state.receipts : [];
}

function summarySnapshotRecord(receipt = {}, turn = {}, file = "", contentHash = "") {
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

async function writeSummarySnapshot(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function readSummarySnapshots(sessionDir, records = []) {
  const snapshots = [];
  for (const record of collectSummarySnapshotRecords(records)) {
    const file = String(record?.file || "").trim();
    const snapshotPathname = resolveSummarySnapshotPath(sessionDir, file);
    const payload = await readJsonArtifactFile(snapshotPathname, null);
    if (!payload || payload.checkpointId !== record.checkpointId || payload.checkpointRevision !== record.checkpointRevision) {
      const error = new Error(`summary snapshot does not match its journal index: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_INDEX_MISMATCH";
      throw error;
    }
    const canonical = JSON.stringify(payload);
    const contentHash = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    if (contentHash !== record.contentHash) {
      const error = new Error(`summary snapshot hash mismatch: ${file}`);
      error.code = "SESSION_SUMMARY_SNAPSHOT_HASH_MISMATCH";
      throw error;
    }
    snapshots.push({ ...record, payload });
  }
  return snapshots;
}

async function readJournalRecords(file, committedBytes) {
  let raw;
  try { raw = await readFile(file); } catch (error) {
    if (error?.code === "ENOENT" && Number(committedBytes || 0) === 0) return [];
    if (error?.code === "ENOENT") {
      const failure = new Error(`session turn journal is missing: ${file}`);
      failure.code = "SESSION_TURN_ARTIFACT_MISSING";
      throw failure;
    }
    throw error;
  }
  const limit = Math.max(0, Math.min(raw.length, Number(committedBytes) || 0));
  const text = raw.subarray(0, limit).toString("utf8");
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (error) {
      const failure = new Error(`turn journal is corrupted: ${file}`);
      failure.code = "ARTIFACT_JSON_CORRUPTED";
      failure.cause = error;
      throw failure;
    }
  }
  return records;
}

function materializeJournal(records, order = [], baseMessages = []) {
  const byUid = new Map((Array.isArray(baseMessages) ? baseMessages : [])
    .map((message) => [String(message?.messageUid || "").trim(), message])
    .filter(([uid]) => uid));
  for (const record of records) {
    const uid = String(record?.messageUid || "").trim();
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && record.message && typeof record.message === "object") byUid.set(uid, record.message);
  }
  const ordered = (Array.isArray(order) ? order : []).map((uid) => byUid.get(String(uid || "").trim())).filter(Boolean);
  const remaining = [...byUid.entries()].filter(([uid]) => !order.includes(uid)).map(([, message]) => message);
  return [...ordered, ...remaining];
}

function collectSummarySnapshotRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter((record) => record?.op === "summary_snapshot");
}

async function appendJournal(file, records, committedBytes = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  let currentSize = 0;
  try { currentSize = (await stat(file)).size; } catch (error) { if (error?.code !== "ENOENT") throw error; }
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

async function replaceJournalRecords(file, records) {
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

async function replaceJournal(file, messages, summaryRecords = []) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const records = messages.map((message) => ({ op: "upsert", messageUid: message.messageUid, message, hash: messageHash(message) }));
  records.push(...summaryRecords);
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

export async function readRecentSessionTurns({ sessionDir = "", limit = 10, fallback = null } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, fallback);
  if (!session || typeof session !== "object") return [];
  const count = Math.max(0, Number(limit) || 0);
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("recent Session turns require the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  const turns = [];
  for (const item of (Array.isArray(session.turnOrder) ? session.turnOrder : []).slice(-count)) {
    const records = await readJournalRecords(journalPath(sessionDir, item.turnId), item.committedBytes);
    const summarySnapshots = await readSummarySnapshots(sessionDir, records);
    turns.push({
      turnId: item.turnId,
      artifactOrdinal: item.artifactOrdinal,
      turnScopeId: item.turnScopeId,
      dialogProcessId: item.dialogProcessId,
      messages: materializeJournal(records, item.messageOrder, summarySnapshots.at(-1)?.payload?.messages),
      summarySnapshots,
    });
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
  if (!session || typeof session !== "object") return null;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("session turn lookup requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  const normalizedTurnScopeId = String(turnScopeId || "").trim();
  const normalizedDialogProcessId = String(dialogProcessId || "").trim();
  if (!normalizedTurnScopeId) {
    const error = new Error("turnScopeId is required");
    error.code = "SESSION_TURN_IDENTITY_REQUIRED";
    throw error;
  }
  const matches = (Array.isArray(session.turnOrder) ? session.turnOrder : []).filter((item) => {
    if (normalizedTurnScopeId && String(item?.turnScopeId || "").trim() !== normalizedTurnScopeId) return false;
    if (normalizedDialogProcessId && String(item?.dialogProcessId || "").trim() !== normalizedDialogProcessId) return false;
    return true;
  });
  if (matches.length > 1) {
    const error = new Error("session turn identity is ambiguous");
    error.code = "SESSION_TURN_IDENTITY_AMBIGUOUS";
    throw error;
  }
  const item = matches[0];
  if (!item) return null;
  const records = await readJournalRecords(
    journalPath(sessionDir, item.turnId),
    item.committedBytes,
  );
  const summarySnapshots = await readSummarySnapshots(sessionDir, records);
  return {
    sessionId: String(session.sessionId || "").trim(),
    turnId: String(item.turnId || "").trim(),
    artifactOrdinal: Number(item.artifactOrdinal || 0),
    turnScopeId: String(item.turnScopeId || "").trim(),
    dialogProcessId: String(item.dialogProcessId || "").trim(),
    messages: materializeJournal(records, item.messageOrder, summarySnapshots.at(-1)?.payload?.messages),
    summarySnapshots,
  };
}

export async function readSessionMessageCount({ sessionDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, null);
  if (!session || typeof session !== "object") return 0;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("session message count requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  return (Array.isArray(session.turnOrder) ? session.turnOrder : []).reduce(
    (count, item) => count + Math.max(0, Number(item?.messageCount || 0)),
    0,
  );
}

function turnContentMetadata(turn) {
  const canonical = JSON.stringify(turn);
  return {
    messageCount: turn.messages.length,
    bytes: Buffer.byteLength(canonical, "utf8"),
    contentHash: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  };
}

export async function readSessionArtifact({
  storageService = null,
  sessionDir = "",
  fallback = null,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback });
  if (!session || typeof session !== "object") return fallback;
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) {
    const error = new Error("Session artifact requires the canonical turn journal schema");
    error.code = "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED";
    throw error;
  }
  const messagesByUid = new Map();
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const records = await readJournalRecords(journalPath(sessionDir, item.turnId), item.committedBytes);
    const summarySnapshots = await readSummarySnapshots(sessionDir, records);
    for (const message of materializeJournal(records, item.messageOrder, summarySnapshots.at(-1)?.payload?.messages)) messagesByUid.set(message.messageUid, message);
  }
  const restoredMessages = (Array.isArray(session.messageOrder) ? session.messageOrder : [])
    .map((reference) => messagesByUid.get(String(reference?.messageUid || "").trim())).filter(Boolean);
  return { ...session, messages: restoredMessages };
}

async function writeJsonWithStorage({
  storageService = null,
  artifactPath = "",
  payload = {},
  atomic = false,
} = {}) {
  if (storageService && typeof storageService.writeJsonAtomic === "function" && atomic) {
    return storageService.writeJsonAtomic(artifactPath, payload);
  }
  if (storageService && typeof storageService.writeJson === "function") {
    return storageService.writeJson(artifactPath, payload);
  }
  if (atomic) {
    const temp = `${artifactPath}.tmp-${process.pid}-${Date.now()}`;
    await writeJsonArtifactFile(temp, payload);
    await rename(temp, artifactPath);
    return;
  }
  return writeJsonArtifactFile(artifactPath, payload);
}

async function readJsonWithStorage({
  storageService = null,
  artifactPath = "",
  fallback = null,
} = {}) {
  if (storageService && typeof storageService.readJson === "function") {
    return storageService.readJson(artifactPath, fallback);
  }
  return readJsonArtifactFile(artifactPath, fallback);
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
  const { turns, messageOrder } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousManifest = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback: null });
  const previousV5 = Number(previousManifest?.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION ? previousManifest : null;
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
    const previousHashes = previous?.messageHashes && typeof previous.messageHashes === "object"
      ? previous.messageHashes
      : {};
    const previousRecords = previous ? await readJournalRecords(file, previous.committedBytes) : [];
    const previousSummaryRecords = collectSummarySnapshotRecords(previousRecords);
    const previousCheckpointIds = new Set(previousSummaryRecords.map((record) => String(record?.checkpointId || "").trim()).filter(Boolean));
    let snapshotCompactedJournal = false;
    const nextByUid = new Map(turn.messages.map((message) => [message.messageUid, message]));
    const nextHashes = {};
    const records = [];
    for (const message of turn.messages) {
      const hash = messageHash(message);
      nextHashes[message.messageUid] = hash;
      if (previousHashes[message.messageUid] !== hash) records.push({ op: "upsert", messageUid: message.messageUid, message, hash });
    }
    for (const uid of Object.keys(previousHashes)) if (!nextByUid.has(uid)) records.push({ op: "remove", messageUid: uid });
    const summaryRecords = [...previousSummaryRecords];
    for (const receipt of resolveTurnSummaryReceipts(normalizedSessionPayload, turn)) {
      const checkpointId = String(receipt?.checkpointId || "").trim();
      const checkpointRevision = Number(receipt?.checkpointRevision || 0);
      if (!checkpointId || !Number.isInteger(checkpointRevision) || checkpointRevision < 1 || previousCheckpointIds.has(checkpointId)) continue;
      const relativeSnapshotFile = path.join(
        SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir,
        turn.turnId,
        `checkpoint-${String(checkpointRevision).padStart(6, "0")}.json`,
      ).replaceAll("\\", "/");
      const snapshotPayload = {
        schemaVersion: 1,
        checkpointId,
        checkpointRevision,
        sessionId: String(normalizedSessionPayload.sessionId || "").trim(),
        turnId: turn.turnId,
        turnScopeId: turn.turnScopeId,
        dialogProcessId: turn.dialogProcessId,
        persistedMessageUids: Array.isArray(receipt?.persistedMessageUids) ? receipt.persistedMessageUids : [],
        summarizedMessageUids: Array.isArray(receipt?.summarizedMessageUids) ? receipt.summarizedMessageUids : [],
        committedAt: String(receipt?.committedAt || "").trim(),
        messages: turn.messages,
      };
      const canonicalSnapshot = JSON.stringify(snapshotPayload);
      const contentHash = `sha256:${createHash("sha256").update(canonicalSnapshot).digest("hex")}`;
      const snapshotFile = path.join(sessionDir, relativeSnapshotFile);
      await writeSummarySnapshot(snapshotFile, snapshotPayload);
      const indexRecord = summarySnapshotRecord(receipt, turn, relativeSnapshotFile, contentHash);
      records.push(indexRecord);
      summaryRecords.push(indexRecord);
      previousCheckpointIds.add(checkpointId);
      snapshotCompactedJournal = true;
    }
    let committedBytes;
    const compact = isTerminalTurn(normalizedSessionPayload, turn) && previous?.compacted !== true;
    if (compact) committedBytes = await replaceJournal(file, turn.messages, summaryRecords);
    else if (snapshotCompactedJournal) committedBytes = await replaceJournalRecords(file, summaryRecords);
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
    messageOrder: normalizedSessionPayload.messages.map((message) => ({ messageUid: message.messageUid })),
  };
  delete manifest.messages;
  const [sessionArtifact] = await Promise.all([
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
      if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")) && !referenced.has(entry.name)) {
        await rm(path.join(files.turnsDir, entry.name), { force: true });
      }
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const referencedSnapshots = new Set();
  for (const turn of turnOrder) {
    const journalRecords = await readJournalRecords(journalPath(sessionDir, turn.turnId), turn.committedBytes);
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
        const relative = path.join(SESSION_ARTIFACT_FILE_NAMES.turnSnapshotsDir, turnEntry.name, entry.name).replaceAll("\\", "/");
        if (!referencedSnapshots.has(relative)) await rm(path.join(turnDir, entry.name), { force: true });
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

export async function readSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionId = "",
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const payload = await readJsonWithStorage({
    storageService,
    artifactPath: files.sessionSummary,
    fallback: null,
  });
  if (!isSessionDisplaySummaryPayload(payload, sessionId)) return null;
  return hydrateSessionSummaryDetails({ storageService, sessionDir, payload });
}

export async function rebuildSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const summaryPayload = buildSessionDisplaySummary(sessionPayload);
  await writeSessionSummaryDetails({ storageService, sessionDir, summaryPayload });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.sessionSummary,
    payload: summaryPayload,
    atomic: true,
  });
  return summaryPayload;
}

export async function writeTaskArtifact({
  storageService = null,
  sessionDir = "",
  taskPayload = {},
  atomic = false,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.task,
    payload: taskPayload,
    atomic,
  });
  return { files, task: taskPayload };
}

export async function writeExecutionArtifact({
  storageService = null,
  sessionDir = "",
  executionPayload = {},
  atomic = true,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await writeJsonWithStorage({
    storageService,
    artifactPath: files.execution,
    payload: executionPayload,
    atomic,
  });
  return { files, execution: executionPayload };
}

export async function appendExecutionLogArtifact({
  storageService = null,
  sessionDir = "",
  executionLog = {},
  executionPayload = {},
  resetExecutionLogs = false,
  atomic = true,
  mutationCoordinator = sessionMutationCoordinator,
  alreadyLocked = false,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  await appendRollingJsonlArtifactLog({
    sessionDir,
    log: executionLog,
    reset: resetExecutionLogs,
    mutationCoordinator,
    alreadyLocked,
  });
  await writeExecutionArtifact({
    storageService,
    sessionDir,
    executionPayload,
    atomic,
  });
  return { files, executionLog, execution: executionPayload };
}
