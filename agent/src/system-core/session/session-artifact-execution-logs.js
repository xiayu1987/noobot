/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "../utils/path-resolver.js";
import { appendFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { sessionMutationCoordinator } from "./session-mutation-coordinator.js";
import { SESSION_ARTIFACT_FILE_NAMES, writeJsonArtifactFile } from "./session-artifact-files.js";

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

export async function writeArtifactIndex(directory, index) {
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
  await rm(path.join(sessionDir, SESSION_ARTIFACT_FILE_NAMES.executionEvents), { force: true });
  return index;
}
