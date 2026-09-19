/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { checkpointContentHash, resolveRepairArtifactPath, text } from "./repair-primitives.js";
import { readRepairJson, readRepairJournal } from "./repair-artifact-io.js";

function messageTimestamp(record, turnId) {
  const timestamp = Date.parse(String(record?.message?.ts || "").trim());
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid message timestamp: ${turnId}`),
    { code: "SESSION_REPAIR_CHECKPOINT_MESSAGE_TIMESTAMP_INVALID" },
  );
}

function checkpointTimestamp(payload, turnId) {
  const timestamp = Date.parse(String(payload?.committedAt || "").trim());
  if (Number.isFinite(timestamp)) return timestamp;
  throw Object.assign(
    new Error(`Cannot resegment checkpoint baseline with an invalid commit timestamp: ${turnId}`),
    { code: "SESSION_REPAIR_CHECKPOINT_TIMESTAMP_INVALID" },
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
      code: "SESSION_REPAIR_CHECKPOINT_CHAIN_INVALID",
    });
  }
}

export async function resegmentMigratedCheckpointBaselines({ sessionDir = "" } = {}) {
  const manifestFile = path.join(sessionDir, "session.json");
  const manifest = await readRepairJson(manifestFile);
  const repaired = [];
  for (const turn of Array.isArray(manifest?.turnOrder) ? manifest.turnOrder : []) {
    const turnId = text(turn?.turnId);
    const journalFile = resolveRepairArtifactPath(sessionDir, turn?.file, "turns", [".jsonl"]);
    const journal = await readRepairJournal(journalFile, turn?.committedBytes);
    const indexes = journal.filter((record) => record?.op === "summary_snapshot");
    const existingTail = journal.filter((record) => record?.op !== "summary_snapshot");
    if (indexes.length < 2) continue;

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
          { code: "SESSION_REPAIR_CHECKPOINT_ORDER_INVALID" },
        );
      }
      checkpoints.push({ index, checkpointFile, payload, committedAt });
      previousHash = index.contentHash;
      previousCommittedAt = committedAt;
    }

    const [baseline, ...following] = checkpoints;
    if (!baseline.payload.records.length || following.some(({ payload }) => payload.records.length))
      continue;
    const incrementalRecords = baseline.payload.records;
    if (
      incrementalRecords.some(
        (record) =>
          record?.op !== "upsert" ||
          !text(record?.messageUid) ||
          text(record?.message?.messageUid) !== text(record?.messageUid),
      )
    ) {
      throw Object.assign(
        new Error(`Migrated checkpoint baseline is not a canonical upsert set: ${turnId}`),
        { code: "SESSION_REPAIR_CHECKPOINT_BASELINE_INVALID" },
      );
    }

    const buckets = checkpoints.map(() => []);
    const repairedTail = [];
    for (const record of incrementalRecords) {
      const createdAt = messageTimestamp(record, turnId);
      const checkpointIndex = checkpoints.findIndex(({ committedAt }) => createdAt <= committedAt);
      if (checkpointIndex < 0) repairedTail.push(record);
      else buckets[checkpointIndex].push(record);
    }

    const nextIndexes = [];
    previousHash = "";
    for (let index = 0; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index];
      const payload = {
        ...checkpoint.payload,
        previousCheckpointHash: previousHash,
        records: buckets[index],
      };
      const contentHash = checkpointContentHash(payload);
      await writeFile(checkpoint.checkpointFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      nextIndexes.push({ ...checkpoint.index, contentHash });
      previousHash = contentHash;
    }
    const nextJournal = [...nextIndexes, ...repairedTail, ...existingTail];
    const journalText = nextJournal.map((record) => `${JSON.stringify(record)}\n`).join("");
    await writeFile(journalFile, journalText, "utf8");
    turn.committedBytes = Buffer.byteLength(journalText, "utf8");
    turn.recordCount = nextJournal.length;
    repaired.push({
      turnId,
      checkpointRecordCounts: buckets.map((records) => records.length),
      tailRecordCount: repairedTail.length + existingTail.length,
    });
  }
  if (repaired.length)
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return repaired;
}
