/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_REPAIR_ERROR_CODE } from "@noobot/session-repair";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  createEmptyAuthorityOutboxCheckpoint,
  parseAuthorityOutboxCheckpoint,
  projectAuthorityOutboxJournal,
  serializeAuthorityOutboxCheckpoint,
} from "@noobot/event-protocol/outbox";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { isPlainObject, text } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import { resolveSessionArtifactMutationLock } from "../session-artifact-files.js";

export const AUTHORITY_OUTBOX_DIR = "authority-outbox";
const AUTHORITY_OUTBOX_JOURNAL_FILE = "outbox.jsonl";
const AUTHORITY_OUTBOX_CHECKPOINT_FILE = "outbox-checkpoint.json";

export async function withAuthorityOutboxMutation(sessionDir, operation) {
  return sessionMutationCoordinator.run(resolveSessionArtifactMutationLock(sessionDir), operation);
}

export function authorityOutboxDir(sessionDir = "") {
  return path.join(text(sessionDir), AUTHORITY_OUTBOX_DIR);
}

export function authorityOutboxJournalPath(sessionDir = "") {
  return path.join(authorityOutboxDir(sessionDir), AUTHORITY_OUTBOX_JOURNAL_FILE);
}

function authorityOutboxCheckpointPath(sessionDir = "") {
  return path.join(authorityOutboxDir(sessionDir), AUTHORITY_OUTBOX_CHECKPOINT_FILE);
}

export async function readAuthorityOutboxCheckpoint(sessionDir) {
  let raw;
  try {
    raw = await readFile(authorityOutboxCheckpointPath(sessionDir), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return createEmptyAuthorityOutboxCheckpoint();
    throw error;
  }
  return parseAuthorityOutboxCheckpoint(JSON.parse(raw));
}

export async function writeAuthorityOutboxCheckpoint(sessionDir, checkpoint) {
  const file = authorityOutboxCheckpointPath(sessionDir);
  await mkdir(path.dirname(file), { recursive: true });
  const payload = serializeAuthorityOutboxCheckpoint(checkpoint);
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

export async function readAuthorityOutboxRecords(sessionDir = "") {
  return withAuthorityOutboxMutation(sessionDir, async () => {
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
        failure.code = SESSION_REPAIR_ERROR_CODE.ARTIFACT_JSON_CORRUPTED;
        failure.cause = error;
        throw failure;
      }
    }
    return records;
  });
}

export async function readAuthorityOutbox(sessionDir = "") {
  return projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(sessionDir));
}

export async function appendAuthorityOutboxRecords(sessionDir = "", records = []) {
  const normalized = (Array.isArray(records) ? records : []).filter((record) =>
    isPlainObject(record),
  );
  if (!normalized.length) return 0;
  return withAuthorityOutboxMutation(sessionDir, async () => {
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
  });
}

export async function replaceAuthorityOutboxRecords(sessionDir = "", records = []) {
  return withAuthorityOutboxMutation(sessionDir, async () => {
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
  });
}

export function authorityOutboxCommitRecord(entry = {}) {
  return {
    op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT,
    eventId: text(entry?.eventId),
    envelope: entry?.envelope,
    committedAt: text(entry?.committedAt),
  };
}

export async function readCommittedAuthorityEventIds(sessionDir = "") {
  const records = await readAuthorityOutboxRecords(sessionDir);
  const eventIds = new Set();
  for (const record of records) {
    const eventId = text(record?.eventId);
    if (!eventId) continue;
    if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT) eventIds.add(eventId);
    else if (record.op === AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE) eventIds.delete(eventId);
  }
  return eventIds;
}

export async function removeAuthorityOutboxTurnScopes(sessionDir = "", turnScopeIds = []) {
  const scopes = new Set(
    (Array.isArray(turnScopeIds) ? turnScopeIds : []).map((value) => text(value)).filter(Boolean),
  );
  if (!scopes.size) return 0;
  const outbox = await readAuthorityOutbox(sessionDir);
  const records = outbox
    .filter((item) => scopes.has(text(item?.envelope?.identity?.turnScopeId)))
    .map((item) => ({ op: AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE, eventId: item.eventId }));
  if (!records.length) return 0;
  return appendAuthorityOutboxRecords(sessionDir, records);
}

export function authorityOutboxRecordsFromOutbox(outbox = []) {
  const records = [];
  for (const item of Array.isArray(outbox) ? outbox : []) {
    const eventId = text(item?.eventId);
    if (!eventId) continue;
    records.push(authorityOutboxCommitRecord(item));
    const deliveries =
      item?.deliveries && typeof item.deliveries === "object" ? item.deliveries : {};
    for (const [consumerId, delivery] of Object.entries(deliveries)) {
      const attempts = Math.max(0, Number(delivery?.attempts) || 0);
      for (let index = 0; index < attempts; index += 1) {
        records.push({
          op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
          eventId,
          consumerId,
          attemptedAt: text(delivery.lastAttemptAt),
        });
      }
      if (text(delivery?.deliveredAt)) {
        records.push({
          op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
          eventId,
          consumerId,
          orderingDomain: text(delivery.orderingDomain),
          orderingScopeId: text(delivery.orderingScopeId),
          sequence: Number(delivery.sequence) || 0,
          deliveredAt: text(delivery.deliveredAt),
        });
      }
    }
  }
  return records;
}
