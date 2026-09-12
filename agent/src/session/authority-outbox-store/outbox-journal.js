/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  projectAuthorityOutboxJournal,
} from "@noobot/event-protocol/outbox";
import { mkdir, open, readFile, rename } from "node:fs/promises";

export const AUTHORITY_OUTBOX_DIR = "authority-outbox";
export const AUTHORITY_OUTBOX_JOURNAL_FILE = "outbox.jsonl";
export const AUTHORITY_OUTBOX_CHECKPOINT_FILE = "outbox-checkpoint.json";
export const AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION = 1;

const mutationTails = new Map();

export function authorityOutboxSequenceKey(orderingDomain = "", orderingScopeId = "") {
  return `${String(orderingDomain || "").trim()}\u0000${String(orderingScopeId || "").trim()}`;
}

export async function withAuthorityOutboxMutation(sessionDir = "", operation) {
  const key = String(sessionDir || "").trim();
  const previous = mutationTails.get(key) || Promise.resolve();
  const current = previous.then(operation, operation);
  mutationTails.set(
    key,
    current.then(
      () => {},
      () => {},
    ),
  );
  try {
    return await current;
  } finally {
    if (mutationTails.get(key) === current) mutationTails.delete(key);
  }
}

export function authorityOutboxDir(sessionDir = "") {
  return path.join(String(sessionDir || "").trim(), AUTHORITY_OUTBOX_DIR);
}

export function authorityOutboxJournalPath(sessionDir = "") {
  return path.join(authorityOutboxDir(sessionDir), AUTHORITY_OUTBOX_JOURNAL_FILE);
}

export function authorityOutboxCheckpointPath(sessionDir = "") {
  return path.join(authorityOutboxDir(sessionDir), AUTHORITY_OUTBOX_CHECKPOINT_FILE);
}

export async function readAuthorityOutboxCheckpoint(sessionDir = "") {
  let raw;
  try {
    raw = await readFile(authorityOutboxCheckpointPath(sessionDir), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { sequenceFloors: {} };
    throw error;
  }
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { sequenceFloors: {} };
  }
  const source =
    payload?.sequenceFloors && typeof payload.sequenceFloors === "object" ? payload.sequenceFloors : {};
  const sequenceFloors = {};
  for (const [key, value] of Object.entries(source)) {
    const floor = Math.max(0, Number(value) || 0);
    if (floor > 0) sequenceFloors[key] = floor;
  }
  return { sequenceFloors };
}

export async function writeAuthorityOutboxCheckpoint(sessionDir = "", { sequenceFloors = {} } = {}) {
  const file = authorityOutboxCheckpointPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = {
    schemaVersion: AUTHORITY_OUTBOX_CHECKPOINT_SCHEMA_VERSION,
    sequenceFloors,
  };
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  return payload;
}

export function mergeAuthorityOutboxSequenceFloors(sequenceFloors = {}, outbox = []) {
  const merged = { ...sequenceFloors };
  for (const item of Array.isArray(outbox) ? outbox : []) {
    const ordering = item?.envelope?.ordering;
    if (!ordering) continue;
    const key = authorityOutboxSequenceKey(ordering.domain, ordering.scopeId);
    merged[key] = Math.max(Number(merged[key]) || 0, Number(ordering.sequence) || 0);
  }
  return merged;
}

export async function readAuthorityOutboxRecords(sessionDir = "") {
  const file = authorityOutboxJournalPath(sessionDir);
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      const failure = new Error(`authority outbox journal is corrupted: ${file}`);
      failure.code = "ARTIFACT_JSON_CORRUPTED";
      failure.cause = error;
      throw failure;
    }
  }
  return records;
}

export async function readAuthorityOutbox(sessionDir = "") {
  return projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(sessionDir));
}

export async function appendAuthorityOutboxRecords(sessionDir = "", records = []) {
  const normalized = (Array.isArray(records) ? records : []).filter(
    (record) => record && typeof record === "object" && !Array.isArray(record),
  );
  if (!normalized.length) return 0;
  const file = authorityOutboxJournalPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = normalized.map((record) => `${JSON.stringify(record)}\n`).join("");
  const handle = await open(file, "a");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return normalized.length;
}

export async function replaceAuthorityOutboxRecords(sessionDir = "", records = []) {
  const file = authorityOutboxJournalPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = (Array.isArray(records) ? records : [])
    .map((record) => `${JSON.stringify(record)}\n`)
    .join("");
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temp, "w");
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  return payload.length;
}

export function authorityOutboxCommitRecord(entry = {}) {
  return {
    op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT,
    eventId: String(entry?.eventId || "").trim(),
    envelope: entry?.envelope,
    committedAt: String(entry?.committedAt || "").trim(),
  };
}

export async function readCommittedAuthorityEventIds(sessionDir = "") {
  const records = await readAuthorityOutboxRecords(sessionDir);
  const eventIds = new Set();
  for (const record of records) {
    const eventId = String(record?.eventId || "").trim();
    if (!eventId) continue;
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) eventIds.add(eventId);
    else if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) eventIds.delete(eventId);
  }
  return eventIds;
}

export async function removeAuthorityOutboxTurnScopes(sessionDir = "", turnScopeIds = []) {
  const scopes = new Set(
    (Array.isArray(turnScopeIds) ? turnScopeIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  if (!scopes.size) return 0;
  const outbox = await readAuthorityOutbox(sessionDir);
  const records = outbox
    .filter((item) => scopes.has(String(item?.envelope?.identity?.turnScopeId || "").trim()))
    .map((item) => ({ op: AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE, eventId: item.eventId }));
  if (!records.length) return 0;
  return appendAuthorityOutboxRecords(sessionDir, records);
}

export function authorityOutboxRecordsFromOutbox(outbox = []) {
  const records = [];
  for (const item of Array.isArray(outbox) ? outbox : []) {
    const eventId = String(item?.eventId || "").trim();
    if (!eventId) continue;
    records.push(authorityOutboxCommitRecord(item));
    const delivery = item?.delivery || {};
    const attempts = Math.max(0, Number(delivery.attempts) || 0);
    for (let index = 0; index < attempts; index += 1) {
      records.push({
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
        eventId,
        attemptedAt: String(delivery.lastAttemptAt || "").trim(),
      });
    }
    if (String(delivery.deliveredAt || "").trim()) {
      records.push({
        op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
        eventId,
        consumerId: String(delivery.consumerId || "").trim(),
        orderingDomain: String(delivery.orderingDomain || "").trim(),
        orderingScopeId: String(delivery.orderingScopeId || "").trim(),
        sequence: Number(delivery.sequence) || 0,
        deliveredAt: String(delivery.deliveredAt || "").trim(),
      });
    }
  }
  return records;
}
