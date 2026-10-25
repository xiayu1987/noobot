/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createHash } from "node:crypto";
import {
  SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_LOCATION_MESSAGE_ORDER_SCHEMA_VERSION,
  SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION,
  SESSION_ARTIFACT_SCHEMA_VERSION,
  SESSION_ARTIFACT_TURN_FILES_SCHEMA_VERSION,
  SESSION_ARTIFACT_TURN_JOURNAL_LAYOUT_SCHEMA_VERSION,
  resolveSessionArtifactSchemaVersion,
} from "@noobot/session-protocol";
import { text, isObjectLike, isPlainObject } from "@noobot/shared/value";
import { resolveRepairArtifactPath } from "./repair-primitives.js";
import { readRepairJson, readRepairJournal } from "./repair-artifact-io.js";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

function materializeRepairRecords(records, order, baseMessages = []) {
  const byUid = new Map(
    baseMessages.map((message) => [text(message?.messageUid), message]).filter(([uid]) => uid),
  );
  for (const record of records) {
    const uid = text(record?.messageUid);
    if (!uid) continue;
    if (record.op === "remove") byUid.delete(uid);
    else if (record.op === "upsert" && isObjectLike(record.message)) byUid.set(uid, record.message);
  }
  const orderedUids = order.map(text).filter(Boolean);
  const ordered = orderedUids.map((uid) => byUid.get(uid)).filter(Boolean);
  const selected = new Set(orderedUids);
  return [
    ...ordered,
    ...[...byUid].filter(([uid]) => !selected.has(uid)).map(([, message]) => message),
  ];
}

function isJournalSnapshotIndex(record) {
  return record?.op === "summary_snapshot";
}

export function splitTurnSnapshotIndexes(schemaVersion, item, records) {
  if (schemaVersion >= SESSION_ARTIFACT_MANIFEST_SNAPSHOT_INDEX_SCHEMA_VERSION) {
    if (!Array.isArray(item?.summarySnapshots)) {
      throw Object.assign(new Error("Session turn manifest entry lacks summarySnapshots"), {
        code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_CHAIN_INVALID,
      });
    }
    return { indexes: item.summarySnapshots, journal: records };
  }
  return {
    indexes: records.filter(isJournalSnapshotIndex),
    journal: records.filter((record) => !isJournalSnapshotIndex(record)),
  };
}

async function readLegacyCheckpointMessages(sessionDir, indexes) {
  if (!indexes.length) return [];
  const latest = indexes.at(-1);
  const file = resolveRepairArtifactPath(sessionDir, latest.file, "turn-snapshots", [".json"]);
  const payload = await readRepairJson(file);
  const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  if (
    payload?.checkpointId !== latest.checkpointId ||
    Number(payload?.checkpointRevision) !== Number(latest.checkpointRevision) ||
    contentHash !== latest.contentHash ||
    !Array.isArray(payload.messages)
  ) {
    throw Object.assign(
      new Error(`legacy cumulative checkpoint does not match its index: ${latest.file}`),
      {
        code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_MISMATCH,
      },
    );
  }
  return payload.messages;
}

async function readPreviousCheckpointRecords(sessionDir, indexes) {
  const checkpointRecords = [];
  let previousCheckpointHash = "";
  for (const index of indexes) {
    const file = resolveRepairArtifactPath(sessionDir, index.file, "turn-snapshots", [".json"]);
    const payload = await readRepairJson(file);
    const contentHash = `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
    if (
      Number(payload?.schemaVersion) !== 2 ||
      !Array.isArray(payload?.records) ||
      Object.hasOwn(payload, "messages") ||
      payload.checkpointId !== index.checkpointId ||
      Number(payload.checkpointRevision) !== Number(index.checkpointRevision) ||
      payload.previousCheckpointHash !== previousCheckpointHash ||
      contentHash !== index.contentHash
    ) {
      throw Object.assign(
        new Error(`previous Session checkpoint does not match its index: ${index.file}`),
        { code: SESSION_REPAIR_ERROR_CODE.CHECKPOINT_MISMATCH },
      );
    }
    checkpointRecords.push(...payload.records);
    previousCheckpointHash = index.contentHash;
  }
  return checkpointRecords;
}

function requireLayoutArray(owner, field, label) {
  if (Array.isArray(owner?.[field])) return owner[field];
  throw Object.assign(new TypeError(`${label} lacks ${field} required by its released schema`), {
    code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_FIELD_SCHEMA_MISMATCH,
  });
}

async function readTurnFileMessages(sessionDir, item) {
  const artifact = resolveRepairArtifactPath(sessionDir, item?.file, "turns", [".json"]);
  const turn = await readRepairJson(artifact);
  if (!Array.isArray(turn?.messages)) {
    throw Object.assign(new Error(`legacy Session turn is invalid: ${item?.file}`), {
      code: SESSION_REPAIR_ERROR_CODE.TURN_ARTIFACT_MISSING,
    });
  }
  return turn.messages;
}

async function readTurnJournalMessages(sessionDir, schemaVersion, item) {
  const artifact = resolveRepairArtifactPath(sessionDir, item?.file, "turns", [".jsonl"]);
  const order = requireLayoutArray(item, "messageOrder", "Session turn manifest entry");
  const records = await readRepairJournal(artifact, item?.committedBytes);
  const { indexes, journal } = splitTurnSnapshotIndexes(schemaVersion, item, records);
  if (schemaVersion >= SESSION_ARTIFACT_CHECKPOINT_RECORDS_SCHEMA_VERSION) {
    const checkpointRecords = await readPreviousCheckpointRecords(sessionDir, indexes);
    return materializeRepairRecords([...checkpointRecords, ...journal], order);
  }
  const baseMessages = await readLegacyCheckpointMessages(sessionDir, indexes);
  return materializeRepairRecords(journal, order, baseMessages);
}

function orderByTurnLocation(session, messagesByTurnId) {
  return requireLayoutArray(session, "messageOrder", "Session manifest")
    .map(
      (reference) =>
        messagesByTurnId.get(text(reference?.turnId))?.[Number(reference?.messageIndex)],
    )
    .filter(Boolean);
}

function orderByMessageUid(session, messages) {
  const byUid = new Map();
  for (const message of messages) {
    const uid = text(message?.messageUid);
    if (uid && !byUid.has(uid)) byUid.set(uid, message);
  }
  return requireLayoutArray(session, "messageOrder", "Session manifest")
    .map((reference) => byUid.get(text(reference?.messageUid)))
    .filter(Boolean);
}

export async function readSessionForProtocolRepair({ sessionDir = "", session = null } = {}) {
  if (!isPlainObject(session)) {
    throw Object.assign(new TypeError("Session repair source must be an object"), {
      code: SESSION_REPAIR_ERROR_CODE.REPAIR_SOURCE_INVALID,
    });
  }
  const schemaVersion = resolveSessionArtifactSchemaVersion(session.schemaVersion);
  if (schemaVersion > SESSION_ARTIFACT_SCHEMA_VERSION) {
    throw Object.assign(new TypeError("Session artifact schema is newer than this runtime"), {
      code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_SCHEMA_UNSUPPORTED,
    });
  }
  if (schemaVersion < SESSION_ARTIFACT_TURN_FILES_SCHEMA_VERSION) {
    requireLayoutArray(session, "messages", "Unversioned Session document");
    return session;
  }
  const journalLayout = schemaVersion >= SESSION_ARTIFACT_TURN_JOURNAL_LAYOUT_SCHEMA_VERSION;
  const messagesByTurnId = new Map();
  const messages = [];
  for (const item of requireLayoutArray(session, "turnOrder", "Session manifest")) {
    const turnMessages = journalLayout
      ? await readTurnJournalMessages(sessionDir, schemaVersion, item)
      : await readTurnFileMessages(sessionDir, item);
    messagesByTurnId.set(text(item?.turnId), turnMessages);
    messages.push(...turnMessages);
  }
  if (journalLayout) return { ...session, messages: orderByMessageUid(session, messages) };
  if (schemaVersion >= SESSION_ARTIFACT_LOCATION_MESSAGE_ORDER_SCHEMA_VERSION) {
    return { ...session, messages: orderByTurnLocation(session, messagesByTurnId) };
  }
  return { ...session, messages };
}
