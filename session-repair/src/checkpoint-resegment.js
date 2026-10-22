/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { text } from "@noobot/shared/value";
import { checkpointContentHash, resolveRepairArtifactPath } from "./repair-primitives.js";
import { readRepairJson, readRepairJournal } from "./repair-artifact-io.js";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

function messageTimestamp(record, turnId) {
  const timestamp = Date.parse(text(record?.message?.ts));
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid message timestamp: ${turnId}`),
    { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_MESSAGE_TIMESTAMP_INVALID },
  );
}

function checkpointTimestamp(payload, turnId) {
  const timestamp = Date.parse(text(payload?.committedAt));
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid commit timestamp: ${turnId}`),
    { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_TIMESTAMP_INVALID },
  );
}

function assertCheckpointIndex(payload, index, previousHash, turnId) {
  if (
    Number(payload?.schemaVersion) !== 2 ||
    !Array.isArray(payload.records) ||
    Object.hasOwn(payload, "messages") ||
    payload.checkpointId !== index.checkpointId ||
    Number(payload.checkpointRevision) !== Number(index.checkpointRevision) ||
    payload.previousCheckpointHash !== previousHash ||
    checkpointContentHash(payload) !== index.contentHash
  ) {
    throw Object.assign(new Error(`Cannot resegment an invalid checkpoint chain: ${turnId}`), {
      code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_CHAIN_INVALID,
    });
  }
}

async function readCheckpointChain(sessionDir, indexes, turnId) {
  const checkpoints = [];
  let previousHash = "";
  let previousCommittedAt = -Infinity;
  for (const index of indexes) {
    const checkpointFile = resolveRepairArtifactPath(sessionDir, index.file, "turn-snapshots", [
      ".json",
    ]);
    const payload = await readRepairJson(checkpointFile);
    assertCheckpointIndex(payload, index, previousHash, turnId);
    const committedAt = checkpointTimestamp(payload, turnId);
    if (committedAt <= previousCommittedAt) {
      throw Object.assign(
        new Error(`Checkpoint commit order is not strictly increasing: ${turnId}`),
        { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_ORDER_INVALID },
      );
    }
    checkpoints.push({ index, checkpointFile, payload, committedAt });
    previousHash = index.contentHash;
    previousCommittedAt = committedAt;
  }
  return checkpoints;
}

function assertCanonicalBaseline(records, turnId) {
  const invalid = records.some(
    (record) =>
      record?.op !== "upsert" ||
      !text(record?.messageUid) ||
      text(record?.message?.messageUid) !== text(record?.messageUid),
  );
  if (!invalid) return;
  throw Object.assign(
    new Error(`Migrated checkpoint baseline is not a canonical upsert set: ${turnId}`),
    { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_BASELINE_INVALID },
  );
}

function bucketRecordsByCheckpoint(records, checkpoints, turnId) {
  const buckets = checkpoints.map(() => []);
  const tail = [];
  for (const record of records) {
    const createdAt = messageTimestamp(record, turnId);
    const checkpointIndex = checkpoints.findIndex(({ committedAt }) => createdAt <= committedAt);
    if (checkpointIndex < 0) tail.push(record);
    else buckets[checkpointIndex].push(record);
  }
  return { buckets, tail };
}

async function rewriteCheckpointChain(checkpoints, buckets) {
  const nextIndexes = [];
  let previousHash = "";
  for (const [position, checkpoint] of checkpoints.entries()) {
    const payload = {
      ...checkpoint.payload,
      previousCheckpointHash: previousHash,
      records: buckets[position],
    };
    const contentHash = checkpointContentHash(payload);
    await writeFile(checkpoint.checkpointFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    nextIndexes.push({ ...checkpoint.index, contentHash });
    previousHash = contentHash;
  }
  return nextIndexes;
}

async function resegmentTurn(sessionDir, turn) {
  const turnId = text(turn?.turnId);
  const journalFile = resolveRepairArtifactPath(sessionDir, turn?.file, "turns", [".jsonl"]);
  const journal = await readRepairJournal(journalFile, turn?.committedBytes);
  const indexes = Array.isArray(turn?.summarySnapshots) ? turn.summarySnapshots : [];
  if (indexes.length < 2) return null;
  const checkpoints = await readCheckpointChain(sessionDir, indexes, turnId);
  const [baseline, ...following] = checkpoints;
  if (!baseline.payload.records.length || following.some(({ payload }) => payload.records.length))
    return null;
  assertCanonicalBaseline(baseline.payload.records, turnId);
  const { buckets, tail } = bucketRecordsByCheckpoint(
    baseline.payload.records,
    checkpoints,
    turnId,
  );
  const nextIndexes = await rewriteCheckpointChain(checkpoints, buckets);
  const nextJournal = [...tail, ...journal];
  const journalText = nextJournal.map((record) => `${JSON.stringify(record)}\n`).join("");
  await writeFile(journalFile, journalText, "utf8");
  turn.summarySnapshots = nextIndexes;
  turn.committedBytes = Buffer.byteLength(journalText, "utf8");
  turn.recordCount = nextJournal.length;
  return {
    turnId,
    checkpointRecordCounts: buckets.map((records) => records.length),
    tailRecordCount: nextJournal.length,
  };
}

export async function resegmentMigratedCheckpointBaselines({ sessionDir = "" } = {}) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readRepairJson(manifestFile);
  const repaired = [];
  for (const turn of Array.isArray(manifest?.turnOrder) ? manifest.turnOrder : []) {
    const result = await resegmentTurn(sessionDir, turn);
    if (result) repaired.push(result);
  }
  if (repaired.length)
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return repaired;
}
