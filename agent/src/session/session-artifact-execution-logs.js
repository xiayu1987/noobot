/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open } from "node:fs/promises";
import {
  EXECUTION_EVENT_INDEX_ERROR_CODE,
  EXECUTION_LOG_APPEND_OUTCOME,
  EXECUTION_EVENT_INDEX_FILE,
  EXECUTION_EVENT_SEGMENT_ERROR_CODE,
  EXECUTION_EVENT_TURNS_DIR,
  createSessionExecutionIndex,
  createTurnExecutionIndex,
  decodeExecutionSegmentRecordBytes,
  encodeExecutionLogBatch,
  executionSegmentFileName,
  executionSegmentTornWrite,
  executionLogAppendFailure,
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
import { syncStorageDirectory, withStorageCleanup } from "./session-artifact-io.js";
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
    { durable: true },
  );
}

function* splitSegmentChunk(chunk, fragments, signal) {
  let start = 0;
  let newlineIndex = chunk.indexOf(0x0a);
  while (newlineIndex >= 0) {
    signal?.throwIfAborted();
    const tail = chunk.slice(start, newlineIndex);
    if (fragments.length) {
      fragments.push(tail);
      yield Buffer.concat(fragments);
      fragments.length = 0;
    } else yield tail;
    start = newlineIndex + 1;
    newlineIndex = chunk.indexOf(0x0a, start);
  }
  if (start < chunk.length) fragments.push(chunk.slice(start));
}

async function* iterateSegmentLines(filePath, file, signal) {
  signal?.throwIfAborted();
  const stream = createReadStream(filePath, { signal });
  const fragments = [];
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      yield* splitSegmentChunk(chunk, fragments, signal);
    }
    signal?.throwIfAborted();
    if (fragments.length) throw executionSegmentTornWrite(file);
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

async function readSegmentRecords(turnDir, file, logs, dialogProcessId) {
  await accessSegmentFile(file, async () => {
    for await (const line of iterateSegmentLines(path.join(turnDir, file), file)) {
      logs.push(decodeExecutionSegmentRecordBytes(line, file, dialogProcessId));
    }
  });
}

async function readTurnRecords(turnDir, index, logs, dialogProcessId) {
  for (const segment of index.segments)
    await readSegmentRecords(turnDir, segment.file, logs, dialogProcessId);
}

export async function readTurnExecutionLogs({ storageService, sessionDir, dialogProcessId }) {
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const index = await readExecutionTurnIndex({ storageService, turnDir });
  const logs = [];
  if (index !== null) await readTurnRecords(turnDir, index, logs, dialogProcessId);
  return logs;
}

export async function readRegisteredExecutionTurns({ storageService, sessionDir, signal }) {
  signal?.throwIfAborted();
  const turns = [];
  for (const { dialogProcessId } of await listExecutionEventTurns({ storageService, sessionDir })) {
    signal?.throwIfAborted();
    const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
    const index = await readExecutionTurnIndex({ storageService, turnDir });
    if (index === null) {
      throw indexCorrupted(`execution event turn index is missing: ${dialogProcessId}`);
    }
    turns.push(Object.freeze({ dialogProcessId, turnDir, index }));
  }
  signal?.throwIfAborted();
  return turns;
}

export async function readExecutionSegmentSummary({ turnDir, file, signal, dialogProcessId }) {
  let bytes = 0;
  let records = 0;
  await accessSegmentFile(file, async () => {
    for await (const line of iterateSegmentLines(path.join(turnDir, file), file, signal)) {
      decodeExecutionSegmentRecordBytes(line, file, dialogProcessId);
      bytes += line.length + 1;
      records += 1;
    }
  });
  return Object.freeze({ bytes, records });
}

export async function readExecutionLogs({ storageService, sessionDir }) {
  const logs = [];
  for (const turn of await readRegisteredExecutionTurns({ storageService, sessionDir })) {
    await readTurnRecords(turn.turnDir, turn.index, logs, turn.dialogProcessId);
  }
  return logs;
}

export async function writeSessionExecutionIndex({ storageService, sessionDir, index }) {
  requireStorageService(storageService, "writeSessionExecutionIndex");
  await storageService.writeJsonAtomic(
    path.join(resolveExecutionEventsDir(sessionDir), EXECUTION_EVENT_INDEX_FILE),
    requireSessionExecutionIndex(index),
    { durable: true },
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

async function assertSegmentTail(handle, bytes, file) {
  if (bytes === 0) return;
  const tail = Buffer.allocUnsafe(1);
  await handle.read(tail, 0, 1, bytes - 1);
  if (tail[0] !== 0x0a) throw executionSegmentTornWrite(file);
}

async function reconcileActiveSegment(turnDir, active, dialogProcessId) {
  const activePath = path.join(turnDir, active.file);
  const handle = await accessSegmentFile(active.file, () => open(activePath, "r"));
  return withStorageCleanup(
    async () => {
      const actualBytes = (await handle.stat()).size;
      await assertSegmentTail(handle, actualBytes, active.file);
      if (active.bytes === actualBytes) return active;
      const actual = await readExecutionSegmentSummary({
        turnDir,
        file: active.file,
        dialogProcessId,
      });
      return { ...active, ...actual };
    },
    () => handle.close(),
  );
}

export async function prepareExecutionTurnDirectory(sessionDir, turnDir) {
  await mkdir(turnDir, { recursive: true });

  for (const directory of [
    turnDir,
    path.dirname(turnDir),
    resolveExecutionEventsDir(sessionDir),
    sessionDir,
  ])
    await syncStorageDirectory(directory);
}

async function appendTurnExecutionLogsUnlocked({
  storageService,
  sessionDir,
  dialogProcessId,
  encoded,
  maxSegmentBytes,
  progress,
  start,
}) {
  const turnDir = resolveExecutionTurnDir(sessionDir, dialogProcessId);
  const index = await readExecutionTurnIndex({ storageService, turnDir });

  if (index === null || index.segments.length === 0) {
    const registeredTurns = await listExecutionEventTurns({ storageService, sessionDir });
    if (index === null) {
      await prepareExecutionTurnDirectory(sessionDir, turnDir);
      await writeExecutionTurnIndex({
        storageService,
        turnDir,
        index: createTurnExecutionIndex([]),
      });
    }
    await registerExecutionTurn(storageService, sessionDir, registeredTurns, dialogProcessId);
  }
  const segments = index === null ? [] : [...index.segments];
  let active = segments.at(-1);
  if (active) {
    active = await reconcileActiveSegment(turnDir, active, dialogProcessId);
    segments[segments.length - 1] = active;
  }
  let lines = [];
  let flushed = start;
  let activeIsNew = false;
  const flush = async () => {
    if (lines.length === 0) return;
    const end = flushed + lines.length;
    progress.fill(EXECUTION_LOG_APPEND_OUTCOME.UNKNOWN, flushed, end);
    try {
      await appendFile(path.join(turnDir, active.file), lines.join(""), {
        encoding: "utf8",
        flag: activeIsNew ? "ax" : "a",
        flush: true,
      });
    } catch (cause) {
      if (cause.code !== "EEXIST") throw cause;
      progress.fill(EXECUTION_LOG_APPEND_OUTCOME.NOT_WRITTEN, flushed, end);
      throw Object.assign(
        new Error(`execution segment requires explicit index recovery: ${active.file}`, { cause }),
        {
          code: EXECUTION_EVENT_INDEX_ERROR_CODE.SEGMENT_UNINDEXED,
        },
      );
    }
    if (activeIsNew) await syncStorageDirectory(turnDir);
    progress.fill(EXECUTION_LOG_APPEND_OUTCOME.WRITTEN, flushed, end);
    flushed = end;
    activeIsNew = false;
    lines = [];
  };
  for (const { line, bytes: lineBytes } of encoded) {
    if (!active || (active.bytes > 0 && active.bytes + lineBytes > maxSegmentBytes)) {
      await flush();
      sealActiveSegment(segments, active);
      const sequence = active ? active.sequence + 1 : 1;
      activeIsNew = true;
      active = {
        sequence,
        file: executionSegmentFileName(sequence),
        bytes: 0,
        records: 0,
        sealed: false,
      };
      segments.push(active);
    }
    lines.push(line);
    active = {
      ...active,
      bytes: active.bytes + lineBytes,
      records: active.records + 1,
      ...(lineBytes > maxSegmentBytes ? { oversized: true } : {}),
    };
    segments[segments.length - 1] = active;
  }
  await flush();
  const next = createTurnExecutionIndex(segments);
  await writeExecutionTurnIndex({ storageService, turnDir, index: next });
  return next;
}

const rollingLogQueues = new Map();

function sealActiveSegment(segments, active) {
  if (active) segments[segments.length - 1] = { ...active, sealed: true };
}

export async function appendRollingJsonlArtifactLog({
  storageService,
  sessionDir,
  log,
  maxSegmentBytes,
  alreadyLocked,
}) {
  return appendRollingJsonlArtifactLogs({
    storageService,
    sessionDir,
    logs: [log],
    maxSegmentBytes,
    alreadyLocked,
  });
}

export async function appendRollingJsonlArtifactLogs({
  storageService,
  sessionDir,
  logs,
  maxSegmentBytes,
  alreadyLocked,
}) {
  requireStorageService(storageService, "appendRollingJsonlArtifactLog");
  requireSessionDir(sessionDir, "appendRollingJsonlArtifactLog");
  requirePositiveInteger("appendRollingJsonlArtifactLog", "maxSegmentBytes", maxSegmentBytes);
  requireBoolean("appendRollingJsonlArtifactLog", "alreadyLocked", alreadyLocked);
  const encoded = encodeExecutionLogBatch(logs);
  const append = () =>
    appendEncodedExecutionLogs({ storageService, sessionDir, encoded, maxSegmentBytes });
  return alreadyLocked
    ? append()
    : sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), append);
}

function executionTurnGroupEnd(encoded, start) {
  let end = start + 1;
  while (end < encoded.length && encoded[end].dialogProcessId === encoded[start].dialogProcessId)
    end += 1;
  return end;
}

async function appendEncodedExecutionLogs({
  storageService,
  sessionDir,
  encoded,
  maxSegmentBytes,
}) {
  const queueKey = path.resolve(resolveExecutionEventsDir(sessionDir));
  const previous = rollingLogQueues.get(queueKey) || Promise.resolve();
  const append = async () => {
    let result;
    const progress = encoded.map(() => EXECUTION_LOG_APPEND_OUTCOME.NOT_WRITTEN);
    try {
      for (let start = 0; start < encoded.length;) {
        const end = executionTurnGroupEnd(encoded, start);
        result = await appendTurnExecutionLogsUnlocked({
          storageService,
          sessionDir,
          dialogProcessId: encoded[start].dialogProcessId,
          encoded: encoded.slice(start, end),
          maxSegmentBytes,
          progress,
          start,
        });
        start = end;
      }
      return result;
    } catch (cause) {
      throw executionLogAppendFailure(
        cause,
        encoded.map(({ line }) => JSON.parse(line)),
        progress,
      );
    }
  };
  const operation = previous.then(append, append);
  rollingLogQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (rollingLogQueues.get(queueKey) === operation) rollingLogQueues.delete(queueKey);
  }
}
