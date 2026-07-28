/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../shared/utils/path-resolver.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { buildSessionDisplaySummary, isSessionDisplaySummaryPayload } from "./session-summary-builders.js";
import { assertSessionMessageIdentityInvariants, normalizeSessionEntity } from "./entities/session-entity.js";
import { resolveMessageDialogProcessId } from "../context/session/dialog-process-id-resolver.js";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { buildSessionArtifactFileMap, SESSION_ARTIFACT_FILE_NAMES, assertArtifactSessionWritable, readJsonArtifactFile, writeJsonArtifactFile } from "./session-artifact-files.js";
import { appendRollingJsonlArtifactLog, readJsonlArtifactFile } from "./session-artifact-execution-logs.js";

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
  if (Array.isArray(session.messages)) return session;
  const messages = [];
  const messagesByTurnId = new Map();
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
    const turnId = String(item?.turnId || turn?.turnId || "").trim();
    if (turnId) messagesByTurnId.set(turnId, turn.messages);
    messages.push(...turn.messages);
  }
  const messageOrder = Array.isArray(session.messageOrder) ? session.messageOrder : [];
  const restoredMessages = messageOrder.length
    ? messageOrder.map((reference) => messagesByTurnId.get(String(reference?.turnId || "").trim())?.[Number(reference?.messageIndex)]).filter(Boolean)
    : messages;
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
  assertSessionMessageIdentityInvariants(normalizedSessionPayload.messages);
  const summaryPayload = buildSessionDisplaySummary(normalizedSessionPayload, { depth });
  const { turns, messageOrder } = splitSessionMessages(
    normalizedSessionPayload.messages,
    normalizedSessionPayload.dialogOrder,
  );
  const previousManifest = await readJsonWithStorage({ storageService, artifactPath: files.session, fallback: null });
  const previousById = new Map((Array.isArray(previousManifest?.turnOrder) ? previousManifest.turnOrder : []).map((item) => [item?.turnId, item]));
  const artifactTurns = turns.map(({ sourceIndices, ...turn }) => turn);
  const turnOrder = artifactTurns.map((turn) => ({
      turnId: turn.turnId,
      artifactOrdinal: turn.artifactOrdinal,
      turnScopeId: turn.turnScopeId,
      dialogProcessId: turn.dialogProcessId,
      file: `${SESSION_ARTIFACT_FILE_NAMES.turnsDir}/${turn.turnId}.json`,
      ...turnContentMetadata(turn),
    }));
  await mkdir(files.turnsDir, { recursive: true });
  for (let index = 0; index < turns.length; index += 1) {
    const turn = artifactTurns[index];
    const artifactPath = path.join(files.turnsDir, `${turn.turnId}.json`);
    const previous = previousById.get(turn.turnId);
    if (!previous?.contentHash || previous.contentHash !== turnOrder[index].contentHash) {
      await writeJsonWithStorage({ storageService, artifactPath, payload: turn, atomic: true });
    }
  }
  const manifest = {
    ...normalizedSessionPayload,
    schemaVersion: 4,
    messageIdentityVersion: 1,
    turnOrder,
    messageOrder,
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
