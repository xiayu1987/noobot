/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { SESSION_REPAIR_ERROR_CODE } from "@noobot/session-repair";
import {
  AUTHORITY_OUTBOX_JOURNAL_OP,
  applyAuthorityOutboxJournalRecords,
  assertAuthorityOutboxJournalRecord,
  createAuthorityOutboxProjection,
  createEmptyAuthorityOutboxCheckpoint,
  planAuthorityOutboxJournalRecords,
  listAuthorityOutboxProjection,
  normalizeAuthorityEventOutbox,
  parseAuthorityOutboxCheckpoint,
  serializeAuthorityOutboxCheckpoint,
} from "@noobot/event-protocol/outbox";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { text } from "@noobot/shared/value";
import { sessionMutationCoordinator } from "../session-mutation-coordinator.js";
import {
  resolveSessionArtifactMutationLock,
  buildSessionArtifactFileMap,
} from "../session-artifact-files.js";
import {
  collectUnmaterializedTurnCommits,
  collectUnmaterializedArtifactCommits,
  requirePreparedOutboxEvent,
} from "@noobot/event-protocol/turn-outbox";
import { readFileIdentity } from "../session-artifact-session/verified-snapshot-cache.js";
import { readSessionArtifactEvents } from "../session-artifact-session/artifact-event-journal.js";
import { recordStorageWork } from "../session-artifact-session/storage-transaction.js";

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
  recordStorageWork("outboxCheckpointReads");
  const state = journalProjections.get(path.resolve(authorityOutboxJournalPath(sessionDir)));
  let raw;
  try {
    raw = await readFile(authorityOutboxCheckpointPath(sessionDir), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (state) state.checkpoint = null;
    return createEmptyAuthorityOutboxCheckpoint();
  }
  if (state?.checkpoint?.source === raw) return state.checkpoint.value;
  const value = parseAuthorityOutboxCheckpoint(JSON.parse(raw));
  if (state) state.checkpoint = { source: raw, value };
  return value;
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

function journalCorrupted(file, cause) {
  const failure = new Error(`authority outbox journal is corrupted: ${file}`);
  failure.code = SESSION_REPAIR_ERROR_CODE.ARTIFACT_JSON_CORRUPTED;
  failure.cause = cause;
  return failure;
}

function parseJournalRecords(file, raw) {
  const records = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      throw journalCorrupted(file, error);
    }
  }
  return records;
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
    return parseJournalRecords(file, raw);
  });
}

const journalProjections = new Map();

function emptyJournalState() {
  return {
    projection: createAuthorityOutboxProjection(),
    device: null,
    inode: null,
    offset: 0,
    tail: Buffer.alloc(0),
    materializedManifest: "",
    checkpoint: null,
  };
}

function rememberJournalState(key, state) {
  journalProjections.delete(key);
  journalProjections.set(key, state);
  const maxCachedSessions =
    QUANTITY_THRESHOLDS.eventProtocol.authorityOutboxProjectionCacheSessions;
  while (journalProjections.size > maxCachedSessions) {
    journalProjections.delete(journalProjections.keys().next().value);
  }
}

async function readJournalBytes(handle, position, length) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await handle.read(buffer, read, length - read, position + read);
    if (bytesRead === 0) break;
    read += bytesRead;
  }
  return buffer.subarray(0, read);
}

async function continuesCachedJournal(handle, info, state) {
  if (!state || state.device !== info.dev || state.inode !== info.ino) return false;
  const size = Number(info.size);
  if (size < state.offset) return false;
  const guard = await readJournalBytes(handle, state.offset - state.tail.length, state.tail.length);
  return guard.equals(state.tail);
}

async function syncJournalProjection(sessionDir) {
  recordStorageWork("outboxJournalSynchronizations");
  const file = authorityOutboxJournalPath(sessionDir);
  const key = path.resolve(file);
  let handle;
  try {
    handle = await open(file, "r");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const cached = journalProjections.get(key);
    if (cached && cached.inode === null) return cached;
    const empty = emptyJournalState();
    rememberJournalState(key, empty);
    return empty;
  }
  try {
    const info = await handle.stat({ bigint: true });
    const size = Number(info.size);
    const cached = journalProjections.get(key);
    const continued = await continuesCachedJournal(handle, info, cached);
    const base = continued ? cached : emptyJournalState();
    if (continued && size === base.offset) {
      rememberJournalState(key, base);
      return base;
    }
    const appended = await readJournalBytes(handle, base.offset, size - base.offset);
    const projection = base.projection;
    applyAuthorityOutboxJournalRecords(
      projection,
      parseJournalRecords(file, appended.toString("utf8")),
    );
    const state = {
      projection,
      device: info.dev,
      inode: info.ino,
      offset: base.offset + appended.length,
      tail: Buffer.concat([base.tail, appended]).subarray(
        -LENGTH_THRESHOLDS.artifact.authorityOutboxJournalTailGuardBytes,
      ),
      materializedManifest: base.materializedManifest,
      checkpoint: base.checkpoint,
    };
    rememberJournalState(key, state);
    return state;
  } finally {
    await handle.close();
  }
}

async function readStableManifestIdentity(file) {
  try {
    const identity = await readFileIdentity(file);
    return { exists: true, key: identity.reusable ? identity.key : "" };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, key: "" };
    throw error;
  }
}

async function materializeTurnCommits(sessionDir, lifecycle, synchronized) {
  const state = synchronized?.state || (await syncJournalProjection(sessionDir));
  const additions = collectUnmaterializedTurnCommits(
    state.projection,
    lifecycle,
    synchronized?.checkpoint || (await readAuthorityOutboxCheckpoint(sessionDir)),
  );
  if (!additions.length) return 0;
  planAuthorityOutboxJournalRecords(state.projection, structuredClone(additions));
  await appendAuthorityOutboxRecords(sessionDir, additions);
  return additions.length;
}

export async function readAuthorityOutboxProjection(sessionDir = "") {
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const manifestFile = buildSessionArtifactFileMap(sessionDir).session;
    const manifest = await readStableManifestIdentity(manifestFile);
    const state = await syncJournalProjection(sessionDir);
    if (!manifest.exists) return state.projection;
    if (manifest.key && state.materializedManifest === manifest.key) return state.projection;
    const sessionManifest = JSON.parse(await readFile(manifestFile, "utf8"));
    const { turnLifecycle } = sessionManifest;
    const sessionArtifactEvents = await readSessionArtifactEvents(sessionDir, sessionManifest);
    const checkpoint = await readAuthorityOutboxCheckpoint(sessionDir);
    const turnCommits = await materializeTurnCommits(sessionDir, turnLifecycle, {
      state,
      checkpoint,
    });
    const artifactState = turnCommits ? await syncJournalProjection(sessionDir) : state;
    const artifactCommits = collectUnmaterializedArtifactCommits(
      artifactState.projection,
      sessionArtifactEvents.map((envelope) => envelope.identity.eventId),
      checkpoint,
    );
    await appendAuthorityOutboxRecords(sessionDir, artifactCommits);
    const materialized = artifactCommits.length
      ? await syncJournalProjection(sessionDir)
      : artifactState;
    materialized.materializedManifest = manifest.key;
    return materialized.projection;
  });
}

export async function readAuthorityOutbox(sessionDir = "") {
  return listAuthorityOutboxProjection(await readAuthorityOutboxProjection(sessionDir));
}

export async function materializeCommittedTurnEvents(sessionDir, lifecycle) {
  return withAuthorityOutboxMutation(sessionDir, () =>
    materializeTurnCommits(sessionDir, lifecycle),
  );
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
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const file = authorityOutboxJournalPath(sessionDir);
    const payload = Buffer.from(records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    const projection = applyAuthorityOutboxJournalRecords(
      createAuthorityOutboxProjection(),
      parseJournalRecords(file, payload.toString("utf8")),
    );
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
    const handle = await open(temp, "w");
    let info;
    try {
      await handle.writeFile(payload);
      await handle.sync();
      info = await handle.stat({ bigint: true });
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    rememberJournalState(path.resolve(file), {
      projection,
      device: info.dev,
      inode: info.ino,
      offset: payload.length,
      tail: Buffer.from(
        payload.subarray(-LENGTH_THRESHOLDS.artifact.authorityOutboxJournalTailGuardBytes),
      ),
      materializedManifest: "",
      checkpoint: null,
    });
    return payload.length;
  });
}

export async function compactAuthorityOutboxRecords(sessionDir, outbox) {
  return withAuthorityOutboxMutation(sessionDir, async () => {
    const projection = await readAuthorityOutboxProjection(sessionDir);
    const manifest = JSON.parse(
      await readFile(buildSessionArtifactFileMap(sessionDir).session, "utf8"),
    );
    const referenced = new Set([
      ...manifest.turnLifecycle.commandReceipts.map((receipt) => receipt.eventId).filter(Boolean),
      ...(await readSessionArtifactEvents(sessionDir, manifest)).map(
        (envelope) => envelope.identity.eventId,
      ),
    ]);
    const records = authorityOutboxRecordsFromOutbox(outbox);
    const retained = new Set(outbox.map((item) => item.eventId));
    for (const eventId of referenced) {
      if (retained.has(eventId)) continue;
      const prepared = requirePreparedOutboxEvent(projection, eventId, "committed event");
      records.push(authorityOutboxPrepareRecord(prepared));
      if (projection.removedEventIds.has(eventId)) {
        records.push({ op: AUTHORITY_OUTBOX_JOURNAL_OP.REMOVE, eventId });
      }
    }
    return replaceAuthorityOutboxRecords(sessionDir, records);
  });
}

export function authorityOutboxPrepareRecord(entry) {
  return {
    op: AUTHORITY_OUTBOX_JOURNAL_OP.PREPARE,
    eventId: entry.eventId,
    envelope: entry.envelope,
    committedAt: entry.committedAt,
  };
}

export function authorityOutboxCommitRecord(entry) {
  return { op: AUTHORITY_OUTBOX_JOURNAL_OP.COMMIT, eventId: entry.eventId };
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

function appendDeliveryRecords(records, item) {
  const eventId = item.eventId;
  for (const [consumerId, delivery] of Object.entries(item.deliveries)) {
    for (let index = 0; index < delivery.attempts; index += 1) {
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

export function authorityOutboxRecordsFromOutbox(outbox) {
  const records = [];
  for (const item of normalizeAuthorityEventOutbox(outbox)) {
    records.push(authorityOutboxPrepareRecord(item), authorityOutboxCommitRecord(item));
    appendDeliveryRecords(records, item);
  }
  return records;
}
