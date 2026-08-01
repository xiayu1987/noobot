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
import { appendRollingJsonlArtifactLog, readJsonlArtifactFile } from "./session-artifact-execution-logs.js";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";

function splitSessionMessages(messages = [], dialogOrder = []) {
  const source = Array.isArray(messages) ? messages : [];
  const logicalOrder = new Map(
    (Array.isArray(dialogOrder) ? dialogOrder : []).map((entry, index) => [
      String(entry?.dialogProcessId || entry?.dialogId || "").trim(),
      Number(entry?.dialogOrdinal) || index + 1,
    ]),
  );
  const buckets = new Map();
  let legacySegment = 0;
  let previousLegacyKey = "";
  source.forEach((message, sourceIndex) => {
    const dialogProcessId = resolveMessageDialogProcessId(message);
    const turnScopeId = String(message?.turnScopeId || "").trim();
    let key = dialogProcessId ? `dialog:${dialogProcessId}` : "";
    if (!key) {
      const scopeKey = turnScopeId ? `scope:${turnScopeId}` : "scope:missing";
      if (scopeKey !== previousLegacyKey || (!turnScopeId && message?.role === "user")) legacySegment += 1;
      previousLegacyKey = scopeKey;
      key = `legacy:${legacySegment}:${scopeKey}`;
    }
    const bucket = buckets.get(key) || {
      dialogProcessId,
      turnScopeId,
      firstSourceIndex: sourceIndex,
      messages: [],
      sourceIndices: [],
    };
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

function messageHash(message) {
  const canonical = JSON.stringify(message);
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function turnKey(turn = {}) {
  return `${String(turn.dialogProcessId || "").trim()}\u0000${String(turn.turnScopeId || "").trim()}`;
}

function isTerminalTurn(session, turn) {
  const scope = String(turn?.turnScopeId || "").trim();
  const dialog = String(turn?.dialogProcessId || "").trim();
  const statuses = Array.isArray(session?.turnStatuses) ? session.turnStatuses : [];
  return statuses.some((item) => String(item?.turnScopeId || "").trim() === scope
    && (!dialog || !String(item?.dialogProcessId || "").trim() || String(item.dialogProcessId).trim() === dialog)
    && ["completed", "user_stopped", "timeout", "failed", "error"].includes(String(item?.status || "").trim().toLowerCase()));
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

function materializeJournal(records, order = []) {
  const byUid = new Map();
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

async function replaceJournal(file, messages) {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const records = messages.map((message) => ({ op: "upsert", messageUid: message.messageUid, message, hash: messageHash(message) }));
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

async function readLegacySessionArtifact({ storageService = null, sessionDir = "", fallback = null } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback });
  if (!session || typeof session !== "object") return fallback;
  if (Array.isArray(session.messages)) return session;
  const messages = [];
  const messagesByTurnId = new Map();
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const file = typeof item === "string" ? item : item?.file;
    if (!file) continue;
    const turn = await readJsonWithStorage({ storageService, artifactPath: resolveTurnArtifactPath(sessionDir, file), fallback: null });
    if (!turn || !Array.isArray(turn.messages)) {
      const error = new Error(`session turn artifact is missing or invalid: ${file}`);
      error.code = "SESSION_TURN_ARTIFACT_MISSING";
      throw error;
    }
    const turnId = String(item?.turnId || turn?.turnId || "").trim();
    if (turnId) messagesByTurnId.set(turnId, turn.messages);
    messages.push(...turn.messages);
  }
  const order = Array.isArray(session.messageOrder) ? session.messageOrder : [];
  return { ...session, messages: order.length
    ? order.map((reference) => messagesByTurnId.get(String(reference?.turnId || "").trim())?.[Number(reference?.messageIndex)]).filter(Boolean)
    : messages };
}

export async function readRecentSessionTurns({ sessionDir = "", limit = 10, fallback = null } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, fallback);
  if (!session || typeof session !== "object") return [];
  const count = Math.max(0, Number(limit) || 0);
  if (Number(session.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION) {
    const turns = [];
    for (const item of (Array.isArray(session.turnOrder) ? session.turnOrder : []).slice(-count)) {
      const records = await readJournalRecords(journalPath(sessionDir, item.turnId), item.committedBytes);
      turns.push({ turnId: item.turnId, artifactOrdinal: item.artifactOrdinal, turnScopeId: item.turnScopeId, dialogProcessId: item.dialogProcessId, messages: materializeJournal(records, item.messageOrder) });
    }
    return turns;
  }
  if (Array.isArray(session.messages)) return splitSessionMessages(session.messages, session.dialogOrder).turns.slice(-count);
  const order = (Array.isArray(session.turnOrder) ? session.turnOrder : []).slice(-count);
  const turns = [];
  for (const item of order) {
    const file = typeof item === "string" ? item : item?.file;
    const turn = await readJsonArtifactFile(resolveTurnArtifactPath(sessionDir, file), null);
    if (!turn || !Array.isArray(turn.messages)) {
      const error = new Error(`session turn artifact is missing or invalid: ${file}`);
      error.code = "SESSION_TURN_ARTIFACT_MISSING";
      throw error;
    }
    turns.push(turn);
  }
  return turns;
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
  if (Number(session.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION) return readLegacySessionArtifact({ storageService, sessionDir, fallback });
  const messagesByUid = new Map();
  for (const item of Array.isArray(session.turnOrder) ? session.turnOrder : []) {
    const records = await readJournalRecords(journalPath(sessionDir, item.turnId), item.committedBytes);
    for (const message of materializeJournal(records, item.messageOrder)) messagesByUid.set(message.messageUid, message);
  }
  const restoredMessages = (Array.isArray(session.messageOrder) ? session.messageOrder : [])
    .map((reference) => messagesByUid.get(String(reference?.messageUid || "").trim())).filter(Boolean);
  return { ...session, messages: restoredMessages };
}

export async function migrateSessionArtifacts({
  sessionDir = "",
  sessionId = "",
  now = () => new Date().toISOString(),
  withMutationLock = null,
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  if (typeof withMutationLock === "function") {
    return withMutationLock(() => migrateSessionArtifacts({
      sessionDir,
      sessionId,
      now,
      assertSessionWritable,
      mutationCoordinator: null,
      mutationLockDir: "",
    }));
  }
  if (mutationLockDir && mutationCoordinator?.run) {
    return mutationCoordinator.run(mutationLockDir, () => migrateSessionArtifacts({
      sessionDir,
      sessionId,
      now,
      assertSessionWritable,
      mutationCoordinator: null,
      mutationLockDir: "",
    }));
  }
  await assertArtifactSessionWritable({ assertSessionWritable, sessionId, sessionDir, operation: "migrate_session_artifacts" });
  const files = buildSessionArtifactFileMap(sessionDir);
  const legacySession = await readJsonArtifactFile(files.session, null);
  const effectiveSessionId = String(sessionId || legacySession?.sessionId || "").trim();
  await assertArtifactSessionWritable({ assertSessionWritable, sessionId: effectiveSessionId, sessionDir, operation: "migrate_session_artifacts" });
  const legacyLogs = await (async () => {
    try {
      const raw = await readFile(files.executionEvents, "utf8");
      return raw.trim() ? raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  })();
  const legacyPayload = legacySession && Number(legacySession.schemaVersion) !== TURN_JOURNAL_SCHEMA_VERSION
    ? await readLegacySessionArtifact({ sessionDir, fallback: legacySession })
    : null;
  if (legacyPayload) {
    await writeSessionArtifact({ sessionDir, sessionPayload: legacyPayload, now });
  }
  if (legacyLogs.length && !(await readJsonArtifactFile(path.join(files.executionEventsDir, "index.json"), null))) {
    await rm(files.executionEventsDir, { recursive: true, force: true });
    for (const log of legacyLogs) await appendRollingJsonlArtifactLog({ sessionDir, log });
  }
  const migrated = await readSessionArtifact({ sessionDir, fallback: legacySession });
  const logs = await readJsonlArtifactFile(files.executionEvents);
  const expectedLegacyMessageCount = legacyPayload?.messages?.length || 0;
  if (expectedLegacyMessageCount && migrated?.messages?.length !== expectedLegacyMessageCount) {
    const error = new Error("session migration message count mismatch");
    error.code = "SESSION_MIGRATION_VALIDATION_FAILED";
    throw error;
  }
  if (legacyLogs.length && logs.length !== legacyLogs.length) {
    const error = new Error("execution migration record count mismatch");
    error.code = "EXECUTION_MIGRATION_VALIDATION_FAILED";
    throw error;
  }
  await rm(files.executionEvents, { force: true });
  return { files, session: migrated, executionLogs: logs };
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
  depth = 0,
  atomic = true,
  now = () => new Date().toISOString(),
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  await mkdir(sessionDir, { recursive: true });
  const normalizedSessionPayload = normalizeSessionEntity(sessionPayload, { now });
  assertSessionMessageIdentityInvariants(normalizedSessionPayload.messages);
  const summaryPayload = buildSessionDisplaySummary(normalizedSessionPayload, { depth });
  const { turns, messageOrder } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousManifest = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback: null });
  const previousV5 = Number(previousManifest?.schemaVersion) === TURN_JOURNAL_SCHEMA_VERSION ? previousManifest : null;
  const previousByKey = new Map((Array.isArray(previousV5?.turnOrder) ? previousV5.turnOrder : []).map((item) => [turnKey(item), item]));
  const usedTurnIds = new Set();
  const artifactTurns = turns.map(({ sourceIndices, ...turn }, index) => {
    const previous = previousByKey.get(turnKey(turn));
    let turnId = String(previous?.turnId || "").trim();
    if (!turnId || usedTurnIds.has(turnId)) turnId = `turn-${String(index + 1).padStart(6, "0")}`;
    usedTurnIds.add(turnId);
    return { ...turn, turnId, artifactOrdinal: index + 1 };
  });
  await mkdir(files.turnsDir, { recursive: true });
  const turnOrder = [];
  for (const turn of artifactTurns) {
    const previous = previousV5?.turnOrder?.find((item) => item.turnId === turn.turnId);
    const file = journalPath(sessionDir, turn.turnId);
    const previousHashes = previous?.messageHashes && typeof previous.messageHashes === "object"
      ? previous.messageHashes
      : {};
    const nextByUid = new Map(turn.messages.map((message) => [message.messageUid, message]));
    const records = [];
    for (const message of turn.messages) {
      const hash = messageHash(message);
      if (previousHashes[message.messageUid] !== hash) records.push({ op: "upsert", messageUid: message.messageUid, message, hash });
    }
    for (const uid of Object.keys(previousHashes)) if (!nextByUid.has(uid)) records.push({ op: "remove", messageUid: uid });
    let committedBytes;
    const compact = isTerminalTurn(normalizedSessionPayload, turn) && previous?.compacted !== true;
    if (compact) committedBytes = await replaceJournal(file, turn.messages);
    else committedBytes = await appendJournal(file, records, previous?.committedBytes || 0);
    turnOrder.push({
      turnId: turn.turnId,
      artifactOrdinal: turn.artifactOrdinal,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      file: `${SESSION_ARTIFACT_FILE_NAMES.turnsDir}/${turn.turnId}.jsonl`,
      committedBytes,
      recordCount: compact ? turn.messages.length : (Number(previous?.recordCount) || 0) + records.length,
      messageCount: turn.messages.length,
      messageOrder: turn.messages.map((message) => message.messageUid),
      messageHashes: Object.fromEntries(turn.messages.map((message) => [message.messageUid, messageHash(message)])),
      compacted: compact || previous?.compacted === true,
    });
  }
  const manifest = {
    ...normalizedSessionPayload,
    schemaVersion: TURN_JOURNAL_SCHEMA_VERSION,
    messageIdentityVersion: 1,
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
  return payload;
}

export async function rebuildSessionDisplaySummaryArtifact({
  storageService = null,
  sessionDir = "",
  sessionPayload = {},
  depth = 0,
} = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const summaryPayload = buildSessionDisplaySummary(sessionPayload, { depth });
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
