/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readFile } from "node:fs/promises";
import {
  EXECUTION_EVENT_INDEX_ERROR_CODE,
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_SEGMENT_ERROR_CODE,
  EXECUTION_EVENT_TURNS_DIR,
  createSessionExecutionIndex,
  createTurnExecutionIndex,
  decodeExecutionSegment,
  decodeExecutionSegmentRecord,
  encodeExecutionSegmentRecord,
  executionSegmentFileName,
  executionSegmentTornWrite,
  requireDialogProcessKey,
  requireSessionExecutionIndex,
  requireTurnExecutionIndex,
} from "@noobot/session-protocol";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
} from "./session-artifact-files.js";
import { requireStorageService } from "./storage-service.js";
import { PERSISTED_JSON_READ_ERROR_CODE } from "../shared/storage/json-file-reader.js";
import { isCanonicalText, requireBoolean, requirePositiveInteger } from "@noobot/shared/value";

function requireSessionDir(sessionDir, owner) {
  if (!isCanonicalText(sessionDir)) throw new TypeError(`${owner} requires sessionDir`);
  return sessionDir;
}

function indexCorrupted(message, cause) {
  const failure = new Error(message, cause ? { cause } : undefined);
  failure.code = EXECUTION_EVENT_INDEX_ERROR_CODE.CORRUPTED;
  return failure;
}

export function resolveExecutionEventsDir(sessionDir) {
  return path.join(
    requireSessionDir(sessionDir, "resolveExecutionEventsDir"),
    SESSION_ARTIFACT_FILE_NAMES.executionEventsDir,
  );
}

export function resolveExecutionTurnDir(sessionDir, dialogProcessId) {
  return path.join(
    resolveExecutionEventsDir(sessionDir),
    EXECUTION_EVENT_TURNS_DIR,
    requireDialogProcessKey(dialogProcessId),
  );
}

async function readIndexDocument(storageService, directory, decode) {
  const indexPath = path.join(directory, EXECUTION_EVENT_INDEX_FILE);
  let document;
  try {
    document = await storageService.readOptionalJson(indexPath);
  } catch (error) {
    if (error.code !== PERSISTED_JSON_READ_ERROR_CODE.CORRUPTED) throw error;
    throw indexCorrupted(`execution event index is corrupted: ${indexPath}`, error);
  }
  return document === null ? null : decode(document);
}

export async function listExecutionEventTurns({ storageService, sessionDir }) {
  requireStorageService(storageService, "listExecutionEventTurns");
  const index = await readIndexDocument(
    storageService,
    resolveExecutionEventsDir(sessionDir),
    requireSessionExecutionIndex,
  );
  return index === null ? [] : index.turns;
}

export async function readExecutionTurnIndex({ storageService, turnDir }) {
  requireStorageService(storageService, "readExecutionTurnIndex");
  return readIndexDocument(storageService, turnDir, requireTurnExecutionIndex);
}

export async function writeExecutionTurnIndex({ storageService, turnDir, index }) {
  requireStorageService(storageService, "writeExecutionTurnIndex");
  await storageService.writeJsonAtomic(
    path.join(turnDir, EXECUTION_EVENT_INDEX_FILE),
    requireTurnExecutionIndex(index),
  );
}

async function* iterateSegmentLines(filePath, file) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let pending = "";
  try {
    for await (const chunk of stream) {
      pending += chunk;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        yield pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    }
    if (pending) throw executionSegmentTornWrite(file);
  } finally {
    stream.destroy();
  }
}

async function accessSegmentFile(file, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const failure = new Error(`execution event segment is missing: ${file}`, { cause: error });
    failure.code = EXECUTION_EVENT_SEGMENT_ERROR_CODE.MISSING;
    throw failure;
  }
}

async function readSegmentRecords(turnDir, file, logs) {
  await accessSegmentFile(file, async () => {
    for await (const line of iterateSegmentLines(path.join(turnDir, file), file)) {
      logs.push(decodeExecutionSegmentRecord(line, file));
    }
  });
}

async function readTurnRecords(turnDir, index, logs) {
  for (const segment of index.segments) await readSegmentRecords(turnDir, segment.file, logs);
}

export async function readTurnExecutionLogs({ storageService, sessionDir, dialogProcessId }) {
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const index = await readExecutionTurnIndex({ storageService, turnDir });
  const logs = [];
  if (index !== null) await readTurnRecords(turnDir, index, logs);
  return logs;
}

export async function readRegisteredExecutionTurns({ storageService, sessionDir }) {
  const turns = [];
  for (const { dialogProcessId } of await listExecutionEventTurns({ storageService, sessionDir })) {
    const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
    const index = await readExecutionTurnIndex({ storageService, turnDir });
    if (index === null) {
      throw indexCorrupted(`execution event turn index is missing: ${dialogProcessId}`);
    }
    turns.push(Object.freeze({ dialogProcessId, turnDir, index }));
  }
  return turns;
}

export async function readExecutionSegmentState({ turnDir, file }) {
  const raw = await accessSegmentFile(file, () => readFile(path.join(turnDir, file), "utf8"));
  return decodeExecutionSegment(raw, file);
}

export async function readExecutionLogs({ storageService, sessionDir }) {
  const logs = [];
  for (const turn of await readRegisteredExecutionTurns({ storageService, sessionDir })) {
    await readTurnRecords(turn.turnDir, turn.index, logs);
  }
  return logs;
}

export async function writeSessionExecutionIndex({ storageService, sessionDir, index }) {
  requireStorageService(storageService, "writeSessionExecutionIndex");
  await storageService.writeJsonAtomic(
    path.join(resolveExecutionEventsDir(sessionDir), EXECUTION_EVENT_INDEX_FILE),
    requireSessionExecutionIndex(index),
  );
}

async function registerExecutionTurn(storageService, sessionDir, turns, dialogProcessId) {
  if (turns.some((turn) => turn.dialogProcessId === dialogProcessId)) return;
  await writeSessionExecutionIndex({
    storageService,
    sessionDir,
    index: createSessionExecutionIndex([...turns, { dialogProcessId }]),
  });
}

async function reconcileActiveSegment(turnDir, active) {
  const activePath = path.join(turnDir, active.file);
  let handle = null;
  try {
    handle = await accessSegmentFile(active.file, () => open(activePath, "r"));
    const actualBytes = (await handle.stat()).size;
    if (actualBytes > 0) {
      const tail = Buffer.allocUnsafe(1);
      await handle.read(tail, 0, 1, actualBytes - 1);
      if (tail[0] !== 0x0a) throw executionSegmentTornWrite(active.file);
    }
    if (active.bytes === actualBytes) return active;
    const actual = decodeExecutionSegment(await handle.readFile("utf8"), active.file);
    return { ...active, bytes: actual.bytes, records: actual.records.length };
  } finally {
    if (handle) {
      await runBestEffort(() => handle.close(), {
        operationName: "sessionArtifactExecutionLog.closeActiveSegment",
        context: { activePath },
      });
    }
  }
}

async function appendTurnExecutionLogUnlocked({
  storageService,
  sessionDir,
  log,
  maxSegmentBytes,
}) {
  const encoded = encodeExecutionSegmentRecord(log);
  const dialogProcessId = requireDialogProcessKey(log.dialogProcessId);
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const index = await readExecutionTurnIndex({ storageService, turnDir });

  const registeredTurns =
    index === null ? await listExecutionEventTurns({ storageService, sessionDir }) : null;
  if (index === null) await mkdir(turnDir, { recursive: true });
  const { line, bytes: lineBytes } = encoded;
  const segments = index === null ? [] : [...index.segments];
  let active = segments.at(-1);
  if (active) {
    active = await reconcileActiveSegment(turnDir, active);
    segments[segments.length - 1] = active;
  }
  if (!active || (active.bytes > 0 && active.bytes + lineBytes > maxSegmentBytes)) {
    if (active) segments[segments.length - 1] = { ...active, sealed: true };
    const sequence = active ? active.sequence + 1 : 1;
    active = {
      sequence,
      file: executionSegmentFileName(sequence),
      bytes: 0,
      records: 0,
      sealed: false,
    };
    segments.push(active);
  }
  await appendFile(path.join(turnDir, active.file), line, "utf8");
  segments[segments.length - 1] = {
    ...active,
    bytes: active.bytes + lineBytes,
    records: active.records + 1,
    ...(lineBytes > maxSegmentBytes ? { oversized: true } : {}),
  };
  const next = createTurnExecutionIndex(segments);
  await writeExecutionTurnIndex({ storageService, turnDir, index: next });
  if (index === null) {
    await registerExecutionTurn(storageService, sessionDir, registeredTurns, dialogProcessId);
  }
  return next;
}

const rollingLogQueues = new Map();

export async function appendRollingJsonlArtifactLog({
  storageService,
  sessionDir,
  log,
  maxSegmentBytes,
  alreadyLocked,
}) {
  requireStorageService(storageService, "appendRollingJsonlArtifactLog");
  requireSessionDir(sessionDir, "appendRollingJsonlArtifactLog");
  requirePositiveInteger("appendRollingJsonlArtifactLog", "maxSegmentBytes", maxSegmentBytes);
  requireBoolean("appendRollingJsonlArtifactLog", "alreadyLocked", alreadyLocked);
  if (!alreadyLocked) {
    return sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), () =>
      appendRollingJsonlArtifactLog({
        storageService,
        sessionDir,
        log,
        maxSegmentBytes,
        alreadyLocked: true,
      }),
    );
  }
  const queueKey = path.resolve(resolveExecutionEventsDir(sessionDir));
  const previous = rollingLogQueues.get(queueKey) || Promise.resolve();
  const append = () =>
    appendTurnExecutionLogUnlocked({ storageService, sessionDir, log, maxSegmentBytes });
  const operation = previous.then(append, append);
  rollingLogQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (rollingLogQueues.get(queueKey) === operation) rollingLogQueues.delete(queueKey);
  }
}
