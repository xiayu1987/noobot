/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { runBestEffort } from "@noobot/shared/best-effort";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readFile, rename } from "node:fs/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { requireDialogProcessKey } from "@noobot/session-protocol";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import {
  SESSION_ARTIFACT_FILE_NAMES,
  resolveSessionArtifactMutationLock,
  writeJsonArtifactFile,
} from "./session-artifact-files.js";

export const EXECUTION_EVENT_TURNS_DIR = "turns";
export const EXECUTION_EVENT_INDEX_FILE = "index.json";
export const EXECUTION_EVENT_INDEX_SCHEMA_VERSION = 2;

function indexCorrupted(message) {
  const failure = new Error(message);
  failure.code = "EXECUTION_EVENT_INDEX_CORRUPTED";
  return failure;
}

function assertIndexSchema(index, indexPath) {
  if (index.schemaVersion === EXECUTION_EVENT_INDEX_SCHEMA_VERSION) return;
  const failure = new Error(
    `execution event index schemaVersion ${index.schemaVersion} is unsupported (expected ${EXECUTION_EVENT_INDEX_SCHEMA_VERSION}): ${indexPath}`,
  );
  failure.code = "EXECUTION_EVENT_INDEX_SCHEMA_UNSUPPORTED";
  throw failure;
}

export function resolveExecutionEventsDir(sessionDir = "") {
  return path.join(String(sessionDir || ""), SESSION_ARTIFACT_FILE_NAMES.executionEventsDir);
}

export function resolveExecutionTurnDir(sessionDir = "", dialogProcessId) {
  return path.join(
    resolveExecutionEventsDir(sessionDir),
    EXECUTION_EVENT_TURNS_DIR,
    requireDialogProcessKey(dialogProcessId),
  );
}

function assertSafeEntryName(name = "", label = "entry") {
  const value = String(name || "");
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw indexCorrupted(`execution event ${label} reference is invalid`);
  }
  return value;
}

async function readIndexFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
  let index;
  try {
    index = JSON.parse(raw);
  } catch {
    throw indexCorrupted("execution event index is corrupted");
  }
  if (!index || typeof index !== "object")
    throw indexCorrupted("execution event index is corrupted");
  assertIndexSchema(index, filePath);
  return index;
}

async function readSessionEventIndex(eventsDir) {
  const index = await readIndexFile(path.join(eventsDir, EXECUTION_EVENT_INDEX_FILE));
  if (!index) return null;
  if (!Array.isArray(index.turns)) throw indexCorrupted("execution event index has no turns");
  return index;
}

export async function listExecutionEventTurns(sessionDir = "") {
  const index = await readSessionEventIndex(resolveExecutionEventsDir(sessionDir));
  if (!index) return [];
  return index.turns.map((turn) => {
    try {
      return { dialogProcessId: requireDialogProcessKey(turn?.dialogProcessId) };
    } catch (error) {
      const failure = indexCorrupted("execution event turn reference is invalid");
      failure.cause = error;
      throw failure;
    }
  });
}

export async function readExecutionTurnIndex(turnDir = "") {
  const index = await readIndexFile(path.join(turnDir, EXECUTION_EVENT_INDEX_FILE));
  if (!index) return null;
  if (!Array.isArray(index.segments)) throw indexCorrupted("execution event index has no segments");
  for (const segment of index.segments) assertSafeEntryName(segment?.file, "segment");
  return index;
}

export async function writeArtifactIndex(directory, index) {
  const target = path.join(directory, EXECUTION_EVENT_INDEX_FILE);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeJsonArtifactFile(temporary, index);
  await rename(temporary, target);
}

async function* iterateJsonlLines(filePath = "", { signal = null } = {}) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let pending = "";
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) return;
      pending += chunk;
      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        if (line.trim()) yield line;
        if (signal?.aborted) return;
        newlineIndex = pending.indexOf("\n");
      }
    }
    if (pending.trim() && !signal?.aborted) yield pending;
  } finally {
    stream.destroy();
  }
}

async function* iterateSegmentRecords(segmentPath, file, { signal }) {
  try {
    for await (const line of iterateJsonlLines(segmentPath, { signal })) {
      try {
        yield JSON.parse(line);
      } catch (error) {
        const failure = new Error(`execution event segment is invalid JSONL: ${file}`);
        failure.code = "EXECUTION_EVENT_JSONL_CORRUPTED";
        failure.cause = error;
        throw failure;
      }
    }
  } catch (error) {
    if (error?.code === "EXECUTION_EVENT_JSONL_CORRUPTED") throw error;
    const failure = new Error(`execution event segment is missing: ${file}`);
    failure.code = "EXECUTION_EVENT_SEGMENT_MISSING";
    failure.cause = error;
    throw failure;
  }
}

async function* iterateTurnRecords(turnDir, { signal }) {
  const index = await readExecutionTurnIndex(turnDir);
  if (!index) return;
  for (const segment of index.segments) {
    if (signal?.aborted) return;
    const segmentPath = path.join(turnDir, segment.file);
    for await (const record of iterateSegmentRecords(segmentPath, segment.file, { signal })) {
      if (signal?.aborted) return;
      yield record;
    }
  }
}

export async function* iterateExecutionLogs(
  sessionDir = "",
  { dialogProcessId = undefined, signal = null } = {},
) {
  if (dialogProcessId !== undefined) {
    yield* iterateTurnRecords(resolveExecutionTurnDir(sessionDir, dialogProcessId), { signal });
    return;
  }
  const eventsDir = resolveExecutionEventsDir(sessionDir);
  for (const turn of await listExecutionEventTurns(sessionDir)) {
    if (signal?.aborted) return;
    const turnDir = path.join(eventsDir, EXECUTION_EVENT_TURNS_DIR, turn.dialogProcessId);
    yield* iterateTurnRecords(turnDir, { signal });
  }
}

export async function readExecutionLogs(sessionDir = "", options = {}) {
  const logs = [];
  for await (const log of iterateExecutionLogs(sessionDir, options)) logs.push(log);
  return logs;
}

function serializeJsonl(log) {
  return `${JSON.stringify(log && typeof log === "object" ? log : { value: log })}\n`;
}

async function registerExecutionTurn(eventsDir, dialogProcessId) {
  const index = (await readSessionEventIndex(eventsDir)) || {
    schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
    turns: [],
  };
  if (index.turns.some((turn) => turn?.dialogProcessId === dialogProcessId)) return;
  index.turns.push({ dialogProcessId });
  await mkdir(eventsDir, { recursive: true });
  await writeArtifactIndex(eventsDir, index);
}

async function reconcileActiveSegment(turnDir, active) {
  const activePath = path.join(turnDir, active.file);
  let handle = null;
  try {
    handle = await open(activePath, "r");
    const actualBytes = Number((await handle.stat()).size || 0);
    if (actualBytes > 0) {
      const tail = Buffer.allocUnsafe(1);
      await handle.read(tail, 0, 1, actualBytes - 1);
      if (tail[0] !== 0x0a) {
        const failure = new Error("active execution segment has a torn final record");
        failure.code = "EXECUTION_EVENT_SEGMENT_TORN_WRITE";
        throw failure;
      }
    }
    const records = Number(active.records);
    if (Number(active.bytes) === actualBytes && Number.isInteger(records) && records >= 0) return;
    const raw = await handle.readFile("utf8");
    const lines = raw ? raw.split("\n").filter(Boolean) : [];
    try {
      for (const line of lines) JSON.parse(line);
    } catch (error) {
      const failure = new Error("active execution segment is invalid JSONL");
      failure.code = "EXECUTION_EVENT_JSONL_CORRUPTED";
      failure.cause = error;
      throw failure;
    }
    active.bytes = actualBytes;
    active.records = lines.length;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    active.bytes = 0;
    active.records = 0;
  } finally {
    if (handle) {
      await runBestEffort(() => handle.close(), {
        operationName: "sessionArtifactExecutionLog.closeActiveSegment",
        context: { activePath },
      });
    }
  }
}

async function appendTurnExecutionLogUnlocked({ sessionDir, log, maxSegmentBytes }) {
  const dialogProcessId = requireDialogProcessKey(log?.dialogProcessId);
  const eventsDir = resolveExecutionEventsDir(sessionDir);
  const turnDir = path.join(eventsDir, EXECUTION_EVENT_TURNS_DIR, dialogProcessId);
  const limit = Math.max(
    1,
    Number(maxSegmentBytes) || LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
  );
  let index = await readExecutionTurnIndex(turnDir);
  if (!index) {
    await registerExecutionTurn(eventsDir, dialogProcessId);
    await mkdir(turnDir, { recursive: true });
    index = {
      schemaVersion: EXECUTION_EVENT_INDEX_SCHEMA_VERSION,
      dialogProcessId,
      activeSequence: 0,
      segments: [],
    };
  }
  const line = serializeJsonl(log);
  const lineBytes = Buffer.byteLength(line, "utf8");
  let active = index.segments[index.segments.length - 1];
  if (active) await reconcileActiveSegment(turnDir, active);
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
  await appendFile(path.join(turnDir, active.file), line, "utf8");
  active.bytes = Number(active.bytes || 0) + lineBytes;
  active.records = Number(active.records || 0) + 1;
  if (lineBytes > limit) active.oversized = true;
  index.maxSegmentBytes = limit;
  index.activeSequence = active.sequence;
  await writeArtifactIndex(turnDir, index);
  return index;
}

const rollingLogQueues = new Map();

export async function appendRollingJsonlArtifactLog({
  sessionDir = "",
  log = {},
  maxSegmentBytes = LENGTH_THRESHOLDS.artifact.executionEventSegmentBytes,
  mutationCoordinator = sessionMutationCoordinator,
  alreadyLocked = false,
} = {}) {
  if (!String(sessionDir || "").trim()) {
    throw new Error("appendRollingJsonlArtifactLog requires sessionDir");
  }
  if (!alreadyLocked && mutationCoordinator?.run) {
    return mutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), () =>
      appendRollingJsonlArtifactLog({ sessionDir, log, maxSegmentBytes, alreadyLocked: true }),
    );
  }
  const queueKey = path.resolve(resolveExecutionEventsDir(sessionDir));
  const previous = rollingLogQueues.get(queueKey) || Promise.resolve();
  const append = () => appendTurnExecutionLogUnlocked({ sessionDir, log, maxSegmentBytes });
  const operation = previous.then(append, append);
  rollingLogQueues.set(queueKey, operation);
  try {
    return await operation;
  } finally {
    if (rollingLogQueues.get(queueKey) === operation) rollingLogQueues.delete(queueKey);
  }
}
