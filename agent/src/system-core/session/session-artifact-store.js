/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { appendFile, mkdir, readFile, writeFile, rm, rename, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import {
  buildSessionDisplaySummary,
  isSessionDisplaySummaryPayload,
} from "./session-summary-builders.js";
import { normalizeSessionEntity } from "./entities/session-entity.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";

export const SESSION_ARTIFACT_FILE_NAMES = Object.freeze({
  session: "session.json",
  sessionSummary: "session-summary.json",
  task: "task.json",
  execution: "execution.json",
  executionEvents: "execution.jsonl",
  executionEventsDir: "execution-events",
  turnsDir: "turns",
  meta: "meta.json",
});

export function buildSessionArtifactFileMap(sessionDir = "") {
  const dir = String(sessionDir || "").trim();
  return {
    session: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.session),
    sessionSummary: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.sessionSummary),
    task: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.task),
    execution: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.execution),
    executionEvents: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEvents),
    executionEventsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir),
    turnsDir: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.turnsDir),
    meta: path.join(dir, SESSION_ARTIFACT_FILE_NAMES.meta),
  };
}

export async function writeJsonArtifactFile(filePath = "", payload = {}) {
  await writeFile(
    filePath,
    `${JSON.stringify(payload && typeof payload === "object" ? payload : {}, null, 2)}\n`,
    "utf8",
  );
}

export async function readJsonArtifactFile(filePath = "", fallback = null) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return fallback;
    const failure = new Error(
      error instanceof SyntaxError ? `artifact JSON is corrupted: ${filePath}` : `artifact JSON cannot be read: ${filePath}`,
    );
    failure.code = error instanceof SyntaxError
      ? "ARTIFACT_JSON_CORRUPTED"
      : error?.code === "EACCES" || error?.code === "EPERM"
        ? "ARTIFACT_PERMISSION_DENIED"
        : "ARTIFACT_IO_FAILED";
    failure.artifactPath = filePath;
    failure.cause = error;
    throw failure;
  }
}

function createSessionDeletedArtifactError(sessionId = "", operation = "session artifact mutation") {
  const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
  error.statusCode = 410;
  error.errorCode = "SESSION_DELETED";
  error.code = "SESSION_DELETED";
  error.sessionId = String(sessionId || "").trim();
  error.operation = operation;
  return error;
}

async function assertArtifactSessionWritable({
  assertSessionWritable = null,
  sessionId = "",
  sessionDir = "",
  operation = "session artifact mutation",
} = {}) {
  if (typeof assertSessionWritable !== "function") return true;
  const result = await assertSessionWritable({ sessionId, sessionDir, operation });
  if (result === false) throw createSessionDeletedArtifactError(sessionId, operation);
  return true;
}

function resolveArtifactMutationLockDir(sessionDir = "", mutationLockDir = "") {
  return String(mutationLockDir || "").trim() || path.join(sessionDir, ".mutation-lock");
}

export async function writeJsonlArtifactFile(filePath = "", logs = []) {
  const lines = (Array.isArray(logs) ? logs : [])
    .map((log) => JSON.stringify(log && typeof log === "object" ? log : { value: log }))
    .join("\n");
  await writeFile(filePath, lines ? `${lines}\n` : "", "utf8");
}

export async function appendJsonlArtifactLog(filePath = "", log = {}, { reset = false } = {}) {
  const serializedLog = `${JSON.stringify(log && typeof log === "object" ? log : { value: log })}\n`;
  if (reset) {
    await writeFile(filePath, serializedLog, "utf8");
  } else {
    await appendFile(filePath, serializedLog, "utf8");
  }
}

export async function* iterateExecutionLogs(filePath = "", { limit = Infinity, signal = null } = {}) {
  const segmentDir = path.join(path.dirname(filePath), SESSION_ARTIFACT_FILE_NAMES.executionEventsDir);
  let yielded = 0;
  try {
    let index;
    try {
      index = JSON.parse(await readFile(path.join(segmentDir, "index.json"), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw error;
      const failure = new Error("execution event index is corrupted");
      failure.code = "EXECUTION_EVENT_INDEX_CORRUPTED";
      throw failure;
    }
    if (!Array.isArray(index?.segments)) {
      const failure = new Error("execution event index has no segments");
      failure.code = "EXECUTION_EVENT_INDEX_CORRUPTED";
      throw failure;
    }
    for (const segment of index.segments) {
      const file = String(segment?.file || "");
      if (!file || file.includes("..") || path.isAbsolute(file)) {
        const failure = new Error("execution event segment reference is invalid");
        failure.code = "EXECUTION_EVENT_INDEX_CORRUPTED";
        throw failure;
      }
      let raw;
      try { raw = await readFile(path.join(segmentDir, file), "utf8"); }
      catch (error) {
        const failure = new Error(`execution event segment is missing: ${file}`);
        failure.code = "EXECUTION_EVENT_SEGMENT_MISSING";
        failure.cause = error;
        throw failure;
      }
      for (const line of raw.split("\n").filter(Boolean)) {
        try {
          if (signal?.aborted || yielded >= limit) return;
          yield JSON.parse(line);
          yielded += 1;
        }
        catch (error) {
          const failure = new Error(`execution event segment is invalid JSONL: ${file}`);
          failure.code = "EXECUTION_EVENT_JSONL_CORRUPTED";
          failure.cause = error;
          throw failure;
        }
      }
    }
    return;
  } catch (error) {
    // During migration the legacy file is the only fallback. Never combine both stores.
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
  }
  try {
    const raw = await readFile(filePath, "utf8");
    for (const line of raw.trim().split("\n").filter(Boolean)) {
      if (signal?.aborted || yielded >= limit) return;
      yield JSON.parse(line);
      yielded += 1;
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return;
    const failure = new Error("legacy execution event JSONL is corrupted");
    failure.code = "EXECUTION_EVENT_JSONL_CORRUPTED";
    failure.cause = error;
    throw failure;
  }
}

export async function readJsonlArtifactFile(filePath = "", options = {}) {
  const logs = [];
  for await (const log of iterateExecutionLogs(filePath, options)) logs.push(log);
  return logs;
}

function serializeJsonl(log) {
  return `${JSON.stringify(log && typeof log === "object" ? log : { value: log })}\n`;
}

async function writeArtifactIndex(directory, index) {
  const target = path.join(directory, "index.json");
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeJsonArtifactFile(temporary, index);
  await rename(temporary, target);
}

const rollingLogQueues = new Map();

export async function appendRollingJsonlArtifactLog({
  sessionDir = "",
  log = {},
  reset = false,
  maxSegmentBytes = LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
  mutationCoordinator = sessionMutationCoordinator,
  alreadyLocked = false,
} = {}) {
  if (!alreadyLocked && mutationCoordinator?.run) {
    return mutationCoordinator.run(path.join(sessionDir, ".mutation-lock"), () => appendRollingJsonlArtifactLog({
      sessionDir, log, reset, maxSegmentBytes, mutationCoordinator, alreadyLocked: true,
    }));
  }
  const queueKey = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir);
  const previous = rollingLogQueues.get(queueKey) || Promise.resolve();
  const operation = previous.catch(() => {}).then(() => appendRollingJsonlArtifactLogUnlocked({
    sessionDir, log, reset, maxSegmentBytes,
  }));
  rollingLogQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (rollingLogQueues.get(queueKey) === operation) rollingLogQueues.delete(queueKey);
  }
}

async function appendRollingJsonlArtifactLogUnlocked({
  sessionDir = "", log = {}, reset = false,
  maxSegmentBytes = LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
} = {}) {
  const directory = path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionEventsDir);
  const line = serializeJsonl(log);
  const lineBytes = Buffer.byteLength(line, "utf8");
  if (reset) await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  let index;
  try {
    index = JSON.parse(await readFile(path.join(directory, "index.json"), "utf8"));
  } catch {
    index = null;
  }
  if (!index || !Array.isArray(index.segments)) {
    index = {
      schemaVersion: 1,
      maxSegmentBytes: Number(maxSegmentBytes),
      activeSequence: 0,
      segments: [],
    };
  }

  let active = index.segments[index.segments.length - 1];
  if (active) {
    const activePath = path.join(directory, String(active.file || ""));
    let raw = "";
    try {
      raw = await readFile(activePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (raw && !raw.endsWith("\n")) {
      const failure = new Error("active execution segment has a torn final record");
      failure.code = "EXECUTION_EVENT_SEGMENT_TORN_WRITE";
      throw failure;
    }
    const records = raw ? raw.split("\n").filter(Boolean) : [];
    try {
      for (const record of records) JSON.parse(record);
    } catch (error) {
      const failure = new Error("active execution segment is invalid JSONL");
      failure.code = "EXECUTION_EVENT_JSONL_CORRUPTED";
      failure.cause = error;
      throw failure;
    }
    // Reconcile the index after an append succeeded but its index rename did not.
    active.bytes = Buffer.byteLength(raw, "utf8");
    active.records = records.length;
  }
  const limit = Math.max(1, Number(maxSegmentBytes) || LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes);
  if (!active || (Number(active.bytes || 0) > 0 && Number(active.bytes || 0) + lineBytes > limit)) {
    const sequence = Number(active?.sequence || index.activeSequence || 0) + 1;
    if (active) active.sealed = true;
    active = {
      sequence,
      file: `segment-${String(sequence).padStart(6, "0")}.jsonl`,
      bytes: 0,
      records: 0,
      sealed: false,
    };
    index.segments.push(active);
  }

  await appendFile(path.join(directory, active.file), line, "utf8");
  active.bytes = Number(active.bytes || 0) + lineBytes;
  active.records = Number(active.records || 0) + 1;
  if (lineBytes > limit) active.oversized = true;
  index.maxSegmentBytes = limit;
  index.activeSequence = active.sequence;
  await writeArtifactIndex(directory, index);
  // A successful segmented commit makes the legacy file stale. Keep only one fact source.
  await rm(path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionEvents), { force: true });
  return index;
}

function splitSessionMessages(messages = []) {
  const turns = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const scope = String(message?.turnScopeId || "").trim();
    const previous = turns[turns.length - 1];
    const startsNew = !previous || scope !== previous.turnScopeId || (!scope && message?.role === "user");
    if (startsNew) {
      turns.push({
        turnId: `turn-${String(turns.length + 1).padStart(6, "0")}`,
        sequence: turns.length + 1,
        turnScopeId: scope,
        messages: [],
      });
    }
    turns[turns.length - 1].messages.push(message);
  }
  return turns;
}

function resolveTurnArtifactPath(sessionDir = "", file = "") {
  const reference = String(file || "").replaceAll("\\", "/");
  const normalized = path.normalize(reference);
  const turnsRoot = path.resolve(sessionDir, SESSION_ARTIFACT_FILE_NAMES.turnsDir);
  const resolved = path.resolve(sessionDir, normalized);
  if (!reference || path.isAbsolute(reference) || reference.includes("\0")
    || normalized === "." || normalized.startsWith(`..${path.sep}`)
    || (resolved !== turnsRoot && !resolved.startsWith(`${turnsRoot}${path.sep}`))
    || path.extname(resolved) !== ".json") {
    const error = new Error(`invalid session turn artifact reference: ${reference}`);
    error.code = "SESSION_TURN_ARTIFACT_PATH_INVALID";
    throw error;
  }
  return resolved;
}

export async function readRecentSessionTurns({ sessionDir = "", limit = 10, fallback = null } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const session = await readJsonArtifactFile(files.session, fallback);
  if (!session || typeof session !== "object") return [];
  const count = Math.max(0, Number(limit) || 0);
  if (Array.isArray(session.messages)) return splitSessionMessages(session.messages).slice(-count);
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
  if (Array.isArray(session.messages)) return session;
  const messages = [];
  const order = Array.isArray(session.turnOrder) ? session.turnOrder : [];
  for (const item of order) {
    const file = typeof item === "string" ? item : item?.file;
    if (!file) continue;
    const turn = await readJsonWithStorage({
      storageService,
      artifactPath: resolveTurnArtifactPath(sessionDir, file),
      fallback: null,
    });
    if (!turn || !Array.isArray(turn.messages)) {
      const error = new Error(`session turn artifact is missing or invalid: ${file}`);
      error.code = "SESSION_TURN_ARTIFACT_MISSING";
      throw error;
    }
    messages.push(...turn.messages);
  }
  return { ...session, messages };
}

/** Migrate legacy inline session messages and execution.jsonl into the v2 layout. */
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
  if (Array.isArray(legacySession?.messages)) {
    await writeSessionArtifact({ sessionDir, sessionPayload: legacySession, now });
  }
  if (legacyLogs.length && !(await readJsonArtifactFile(path.join(files.executionEventsDir, "index.json"), null))) {
    await rm(files.executionEventsDir, { recursive: true, force: true });
    for (const log of legacyLogs) await appendRollingJsonlArtifactLog({ sessionDir, log });
  }
  const migrated = await readSessionArtifact({ sessionDir, fallback: legacySession });
  const logs = await readJsonlArtifactFile(files.executionEvents);
  if (Array.isArray(legacySession?.messages) && migrated?.messages?.length !== legacySession.messages.length) {
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
  const summaryPayload = buildSessionDisplaySummary(normalizedSessionPayload, { depth });
  const turns = splitSessionMessages(normalizedSessionPayload.messages);
  const previousManifest = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback: null });
  const previousById = new Map((Array.isArray(previousManifest?.turnOrder) ? previousManifest.turnOrder : []).map((item) => [item?.turnId, item]));
  const turnOrder = turns.map((turn) => ({
    turnId: turn.turnId,
    sequence: turn.sequence,
    turnScopeId: turn.turnScopeId,
    file: `${SESSION_ARTIFACT_FILE_NAMES.turnsDir}/${turn.turnId}.json`,
    ...turnContentMetadata(turn),
  }));
  await mkdir(files.turnsDir, { recursive: true });
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    const artifactPath = path.join(files.turnsDir, `${turn.turnId}.json`);
    const previous = previousById.get(turn.turnId);
    if (!previous?.contentHash || previous.contentHash !== turnOrder[index].contentHash) {
      await writeJsonWithStorage({ storageService, artifactPath, payload: turn, atomic: true });
    }
  }
  const manifest = { ...normalizedSessionPayload, schemaVersion: 2, turnOrder };
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
  const referenced = new Set(turns.map((turn) => `${turn.turnId}.json`));
  try {
    for (const entry of await readdir(files.turnsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json") && !referenced.has(entry.name)) {
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

function diagnostic(code, message, extra = {}) {
  return { code, message, ...extra };
}

export async function inspectSessionArtifacts({ sessionDir = "" } = {}) {
  const files = buildSessionArtifactFileMap(sessionDir);
  const result = { sessionDir, ok: true, issues: [], turns: { referenced: 0, orphaned: [] }, execution: null };
  const manifest = await readJsonArtifactFile(files.session, null);
  if (!manifest) return { ...result, ok: false, issues: [diagnostic("SESSION_MANIFEST_MISSING", "session manifest is missing")] };
  const referenced = new Set();
  for (const item of Array.isArray(manifest.turnOrder) ? manifest.turnOrder : []) {
    const file = typeof item === "string" ? item : item?.file;
    try { const resolved = resolveTurnArtifactPath(sessionDir, file); referenced.add(path.basename(resolved)); await readJsonArtifactFile(resolved); result.turns.referenced += 1; }
    catch (error) { result.ok = false; result.issues.push(diagnostic(error.code || "TURN_INVALID", error.message, { file })); }
  }
  try { for (const entry of await readdir(files.turnsDir, { withFileTypes: true })) if (entry.isFile() && entry.name.endsWith(".json") && !referenced.has(entry.name)) result.turns.orphaned.push(entry.name); }
  catch (error) { if (error.code !== "ENOENT") { result.ok = false; result.issues.push(diagnostic("TURNS_READ_FAILED", error.message)); } }
  try {
    const index = await readJsonArtifactFile(path.join(files.executionEventsDir, "index.json"), null);
    result.execution = { segments: index?.segments?.length || 0, index };
    if (index?.segments) for (const segment of index.segments) { const raw = await readFile(path.join(files.executionEventsDir, segment.file), "utf8"); const records = raw ? raw.split("\n").filter(Boolean) : []; const bytes = Buffer.byteLength(raw, "utf8"); if (bytes !== Number(segment.bytes) || records.length !== Number(segment.records)) { result.ok = false; result.issues.push(diagnostic("EXECUTION_INDEX_MISMATCH", "execution index does not match segment", { file: segment.file })); } }
  } catch (error) { if (error.code !== "ENOENT") { result.ok = false; result.issues.push(diagnostic(error.code || "EXECUTION_INSPECT_FAILED", error.message)); } }
  return result;
}

export async function cleanupSessionArtifacts({
  sessionDir = "",
  sessionId = "",
  dryRun = true,
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
  allowDeletedCleanup = false,
} = {}) {
  const run = async () => {
    if (!allowDeletedCleanup) {
      await assertArtifactSessionWritable({ assertSessionWritable, sessionId, sessionDir, operation: "cleanup_session_artifacts" });
    }
    const report = await inspectSessionArtifacts({ sessionDir });
    const files = buildSessionArtifactFileMap(sessionDir);
    const removed = [];
    const removePath = async (targetPath, options = {}) => {
      removed.push(targetPath);
      if (!dryRun) await rm(targetPath, { recursive: true, force: true, ...options });
    };
    for (const name of report.turns.orphaned) await removePath(path.join(files.turnsDir, name), { recursive: false });
    for (const dir of [sessionDir, files.turnsDir, files.executionEventsDir]) {
      try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isFile() && (entry.name.endsWith(".tmp") || entry.name.includes(".tmp-"))) await removePath(path.join(dir, entry.name), { recursive: false });
        }
      } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    const parentDir = path.dirname(sessionDir);
    const baseName = path.basename(sessionDir);
    try {
      for (const entry of await readdir(parentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(`${baseName}.staging-`) || entry.name.startsWith(`${baseName}.backup-`)) await removePath(path.join(parentDir, entry.name));
      }
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return { ...report, dryRun, removed };
  };
  const lockDir = resolveArtifactMutationLockDir(sessionDir, mutationLockDir);
  return dryRun || !mutationCoordinator?.run ? run() : mutationCoordinator.run(lockDir, run);
}

export async function repairSessionArtifacts({
  sessionDir = "",
  sessionId = "",
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  const run = async () => {
    await assertArtifactSessionWritable({ assertSessionWritable, sessionId, sessionDir, operation: "repair_session_artifacts" });
    const before = await inspectSessionArtifacts({ sessionDir });
    const files = buildSessionArtifactFileMap(sessionDir);
    const index = await readJsonArtifactFile(path.join(files.executionEventsDir, "index.json"), null);
    const repaired = [];
    if (index?.segments) {
      for (const segment of index.segments) {
        const segmentPath = path.join(files.executionEventsDir, segment.file);
        const raw = await readFile(segmentPath, "utf8");
        if (raw && !raw.endsWith("\n")) {
          const error = new Error(`execution segment has a torn final record: ${segment.file}`);
          error.code = "EXECUTION_EVENT_SEGMENT_TORN_WRITE";
          throw error;
        }
        const records = raw ? raw.split("\n").filter(Boolean) : [];
        for (const record of records) JSON.parse(record);
        const bytes = Buffer.byteLength(raw, "utf8");
        if (Number(segment.bytes) !== bytes || Number(segment.records) !== records.length) {
          segment.bytes = bytes;
          segment.records = records.length;
          repaired.push(segment.file);
        }
      }
      if (repaired.length) await writeArtifactIndex(files.executionEventsDir, index);
    }
    return { before, repaired, after: await inspectSessionArtifacts({ sessionDir }) };
  };
  const lockDir = resolveArtifactMutationLockDir(sessionDir, mutationLockDir);
  return mutationCoordinator?.run ? mutationCoordinator.run(lockDir, run) : run();
}

function createSessionDeletedSnapshotError(sessionId = "") {
  const error = new Error(`session has been deleted: ${String(sessionId || "").trim()}`);
  error.statusCode = 410;
  error.errorCode = "SESSION_DELETED";
  error.code = "SESSION_DELETED";
  error.sessionId = String(sessionId || "").trim();
  return error;
}

export async function persistSessionArtifactSnapshot({
  outputDir = "",
  sessionPayload = {},
  taskPayload = {},
  executionPayload = {},
  metadata = null,
  now = () => new Date().toISOString(),
  mutationCoordinator = sessionMutationCoordinator,
  mutationLockDir = "",
  assertSessionWritable = null,
} = {}) {
  const normalizedSessionPayload = sessionPayload && typeof sessionPayload === "object" ? sessionPayload : {};
  const sessionId = String(normalizedSessionPayload?.sessionId || "").trim();
  const assertWritable = async () => {
    if (typeof assertSessionWritable !== "function") return true;
    const result = await assertSessionWritable({ sessionId, outputDir });
    if (result === false) throw createSessionDeletedSnapshotError(sessionId);
    return true;
  };
  const run = async () => {
    const parentDir = path.dirname(outputDir);
    const stagingDir = `${outputDir}.staging-${process.pid}-${Date.now()}`;
    await assertWritable();
    await mkdir(parentDir, { recursive: true });
    await mkdir(stagingDir, { recursive: true });
    const files = buildSessionArtifactFileMap(stagingDir);
    const normalizedExecutionPayload =
      executionPayload && typeof executionPayload === "object" ? executionPayload : {};
    const executionLogs = Array.isArray(normalizedExecutionPayload?.logs)
      ? normalizedExecutionPayload.logs
      : [];
    let sessionArtifact = null;
    let backupDir = "";
    let hadPrevious = false;
    try {
      [sessionArtifact] = await Promise.all([
        writeSessionArtifact({
          sessionDir: stagingDir,
          sessionPayload: normalizedSessionPayload,
          now,
        }),
        writeTaskArtifact({
          sessionDir: stagingDir,
          taskPayload: taskPayload && typeof taskPayload === "object" ? taskPayload : {},
        }),
        writeExecutionArtifact({
          sessionDir: stagingDir,
          executionPayload: normalizedExecutionPayload,
        }),
        (async () => {
          await rm(files.executionEventsDir, { recursive: true, force: true });
          for (const log of executionLogs) {
            await appendRollingJsonlArtifactLog({ sessionDir: stagingDir, log });
          }
        })(),
        writeJsonArtifactFile(files.meta, metadata && typeof metadata === "object" ? metadata : {}),
      ]);
      await assertWritable();
      const manifest = {
        schemaVersion: 1,
        sessionId: String(sessionArtifact?.session?.sessionId || ""),
        committedAt: now(),
      };
      await writeJsonArtifactFile(path.join(stagingDir, "snapshot-manifest.json"), manifest);
      await writeFile(path.join(stagingDir, "COMMITTED"), `${manifest.committedAt}\n`, "utf8");
      backupDir = `${outputDir}.backup-${process.pid}-${Date.now()}`;
      await assertWritable();
      try {
        await rename(outputDir, backupDir);
        hadPrevious = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      try {
        await assertWritable();
        await rename(stagingDir, outputDir);
        if (hadPrevious) await rm(backupDir, { recursive: true, force: true });
      } catch (error) {
        if (hadPrevious) {
          try {
            await assertWritable();
            await rename(backupDir, outputDir);
          } catch (restoreError) {
            if (restoreError?.code !== "SESSION_DELETED") {
              restoreError.cause = restoreError.cause || error;
              throw restoreError;
            }
          }
        }
        throw error;
      }
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      if (hadPrevious && backupDir) await rm(backupDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const publishedFiles = buildSessionArtifactFileMap(outputDir);
    return {
      outputDir,
      files: publishedFiles,
      session: sessionArtifact?.session || null,
      sessionSummary: sessionArtifact?.sessionSummary || null,
      version: Number(sessionArtifact?.session?.version || sessionArtifact?.sessionSummary?.version || 0),
    };
  };
  const lockDir = String(mutationLockDir || "").trim();
  return lockDir && mutationCoordinator?.run ? mutationCoordinator.run(lockDir, run) : run();
}

export async function readSessionArtifactSnapshot({ outputDir = "", allowLegacy = true } = {}) {
  const committedPath = path.join(outputDir, "COMMITTED");
  const snapshotManifestPath = path.join(outputDir, "snapshot-manifest.json");
  const snapshotManifest = await readJsonArtifactFile(snapshotManifestPath, null);
  let committed = false;
  try { await readFile(committedPath, "utf8"); committed = true; }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (snapshotManifest && !committed) {
    const error = new Error("snapshot is not committed");
    error.code = "SNAPSHOT_NOT_COMMITTED";
    throw error;
  }
  if (!snapshotManifest && !allowLegacy) {
    const error = new Error("snapshot manifest is missing");
    error.code = "SNAPSHOT_MANIFEST_MISSING";
    throw error;
  }
  const files = buildSessionArtifactFileMap(outputDir);
  const [session, sessionSummaryRaw, task, execution, executionLogs, meta] = await Promise.all([
    readSessionArtifact({ sessionDir: outputDir, fallback: null }),
    readJsonArtifactFile(files.sessionSummary, null),
    readJsonArtifactFile(files.task, null),
    readJsonArtifactFile(files.execution, null),
    readJsonlArtifactFile(files.executionEvents),
    readJsonArtifactFile(files.meta, null),
  ]);
  const sessionSummary = isSessionDisplaySummaryPayload(
    sessionSummaryRaw,
    String(session?.sessionId || "").trim(),
  )
    ? sessionSummaryRaw
    : null;
  if (snapshotManifest && String(snapshotManifest.sessionId || "") !== String(session?.sessionId || "")) {
    const error = new Error("snapshot manifest session does not match session artifact");
    error.code = "SNAPSHOT_MANIFEST_MISMATCH";
    throw error;
  }
  return {
    files,
    session,
    sessionSummary,
    task,
    execution,
    executionLogs,
    meta,
  };
}
