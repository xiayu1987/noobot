/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_REPAIR_ERROR_CODE } from "@noobot/session-repair";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  assertAuthorityOutboxJournalRecord,
  createEmptyAuthorityOutboxCheckpoint,
  normalizeAuthorityEventOutbox,
  parseAuthorityOutboxCheckpoint,
  projectAuthorityOutboxJournal,
  serializeAuthorityOutboxCheckpoint,
} from "@noobot/event-protocol/outbox";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { text } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import {
  resolveSessionArtifactMutationLock,
  buildSessionArtifactFileMap,
} from "../session-artifact-files.js";
import { projectCommittedTurnOutbox } from "@noobot/event-protocol/turn-outbox";

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
  return withAuthorityOutboxMutation(sessionDir, async () => {
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(sessionDir));
    }
    await materializeCommittedTurnEvents(sessionDir, manifest.turnLifecycle);
    return projectAuthorityOutboxJournal(await readAuthorityOutboxRecords(sessionDir));
  });
}

export async function materializeCommittedTurnEvents(sessionDir, lifecycle) {
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const projection = projectCommittedTurnOutbox(
      await readAuthorityOutboxRecords(sessionDir),
      lifecycle,
      await readAuthorityOutboxCheckpoint(sessionDir),
    );
    if (projection.added) await replaceAuthorityOutboxRecords(sessionDir, projection.records);
    return projection.added;
  });
}

export async function appendAuthorityOutboxRecords(sessionDir, records) {
  if (!Array.isArray(records)) throw new TypeError("outbox records must be an array");
  records.forEach(assertAuthorityOutboxJournalRecord);
  if (!records.length) return 0;
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const file = authorityOutboxJournalPath(sessionDir);
    await mkdir(path.dirname(file), { recursive: true });
    const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
    const handle = await open(file, "a");
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return records.length;
  });
}

export async function replaceAuthorityOutboxRecords(sessionDir, records) {
  projectAuthorityOutboxJournal(records);
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const file = authorityOutboxJournalPath(sessionDir);
    await mkdir(path.dirname(file), { recursive: true });
    const payload = records.map((record) => `${JSON.stringify(record)}\n`).join("");
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
  return new Set((await readAuthorityOutbox(sessionDir)).map((item) => item.eventId));
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

export function authorityOutboxRecordsFromOutbox(outbox) {
  const records = [];
  for (const item of normalizeAuthorityEventOutbox(outbox)) {
    const eventId = item.eventId;
    records.push(authorityOutboxCommitRecord(item));
    for (const [consumerId, delivery] of Object.entries(item.deliveries)) {
      const attempts = delivery.attempts;
      for (let index = 0; index < attempts; index += 1) {
        records.push({
          op: AUTHORITY_OUTBOX_JOURNAL_OP.ATTEMPT,
          eventId,
          consumerId,
          attemptedAt: delivery.lastAttemptAt,
        });
      }
      if (delivery.deliveredAt) {
        records.push({
          op: AUTHORITY_OUTBOX_JOURNAL_OP.ACK,
          eventId,
          consumerId,
          orderingDomain: delivery.orderingDomain,
          orderingScopeId: delivery.orderingScopeId,
          sequence: delivery.sequence,
          deliveredAt: delivery.deliveredAt,
        });
      }
    }
  }
  return records;
}
