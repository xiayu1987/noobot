/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { storageDigest } from "#storage-digest";
import { SESSION_ERROR_CODE } from "../errors.js";

export const SESSION_STORAGE_JOURNAL_OP = Object.freeze({
  UPSERT: "upsert",
  REMOVE: "remove",
  ORDER: "order",
});

const immutableMessageHashes = new WeakMap();

export function sessionStorageMessageHash(message) {
  const cached = immutableMessageHashes.get(message);
  if (cached) return cached;
  const hash = `sha256:${storageDigest(JSON.stringify(message))}`;
  if (isDeepFrozen(message)) immutableMessageHashes.set(message, hash);
  return hash;
}

function invalidJournal(reason) {
  return Object.assign(new TypeError(`invalid session storage journal: ${reason}`), {
    code: SESSION_ERROR_CODE.TURN_JOURNAL_RECORD_INVALID,
  });
}

function requireOnlyFields(record, fields) {
  if (Object.keys(record).some((field) => !fields.includes(field))) {
    throw invalidJournal("unknown record field");
  }
}

export function assertSessionMessagePositions(positions) {
  if (!Array.isArray(positions)) throw invalidJournal("positions must be an array");
  const identities = new Set();
  const ordinals = new Set();
  for (const position of positions) {
    if (!isPlainObject(position)) throw invalidJournal("position must be an object");
    requireOnlyFields(position, ["messageUid", "ordinal"]);
    if (!isCanonicalText(position.messageUid)) throw invalidJournal("messageUid is required");
    if (!Number.isSafeInteger(position.ordinal) || position.ordinal < 1) {
      throw invalidJournal("ordinal must be a positive integer");
    }
    if (identities.has(position.messageUid) || ordinals.has(position.ordinal)) {
      throw invalidJournal("duplicate message identity or ordinal");
    }
    identities.add(position.messageUid);
    ordinals.add(position.ordinal);
  }
  return positions;
}

export function assertSessionStorageJournalRecord(record) {
  if (!isPlainObject(record)) throw invalidJournal("record must be an object");
  if (record.op === SESSION_STORAGE_JOURNAL_OP.ORDER) {
    requireOnlyFields(record, ["op", "positions"]);
    assertSessionMessagePositions(record.positions);
    return record;
  }
  if (!isCanonicalText(record.messageUid)) throw invalidJournal("messageUid is required");
  if (record.op === SESSION_STORAGE_JOURNAL_OP.REMOVE) {
    requireOnlyFields(record, ["op", "messageUid"]);
    return record;
  }
  if (record.op !== SESSION_STORAGE_JOURNAL_OP.UPSERT) {
    throw invalidJournal("unknown operation");
  }
  requireOnlyFields(record, ["op", "messageUid", "message", "hash"]);
  if (!isPlainObject(record.message) || record.message.messageUid !== record.messageUid) {
    throw invalidJournal("upsert identity does not match its message");
  }
  if (record.hash !== sessionStorageMessageHash(record.message)) {
    throw invalidJournal("hash does not match message content");
  }
  return record;
}

export function createSessionStorageJournalProjection() {
  return { messages: new Map(), hashes: new Map(), positions: [] };
}

export function applySessionStorageJournalRecords(projection, records) {
  if (!Array.isArray(records)) throw invalidJournal("records must be an array");
  for (const record of records) {
    assertSessionStorageJournalRecord(record);
    if (record.op === SESSION_STORAGE_JOURNAL_OP.ORDER) {
      projection.positions = record.positions.map((position) => ({ ...position }));
    } else if (record.op === SESSION_STORAGE_JOURNAL_OP.REMOVE) {
      projection.messages.delete(record.messageUid);
      projection.hashes.delete(record.messageUid);
    } else {
      projection.messages.set(record.messageUid, record.message);
      projection.hashes.set(record.messageUid, record.hash);
    }
  }
  return projection;
}

export function materializeSessionStorageJournal(projection) {
  const positions = assertSessionMessagePositions(projection.positions);
  if (positions.length !== projection.messages.size) {
    throw invalidJournal("positions must cover every materialized message");
  }
  return [...positions]
    .sort((left, right) => left.ordinal - right.ordinal)
    .map(({ messageUid, ordinal }) => {
      const message = projection.messages.get(messageUid);
      if (!message) throw invalidJournal(`ordered message is missing: ${messageUid}`);
      return { message, ordinal, hash: projection.hashes.get(messageUid) };
    });
}

export function createSessionStorageMessageIndex(entries) {
  const positions = entries.map(({ message, ordinal }) => ({
    messageUid: message.messageUid,
    ordinal,
  }));
  assertSessionMessagePositions(positions);
  const ordered = [...entries].sort((left, right) => left.ordinal - right.ordinal);
  return {
    messageCount: ordered.length,
    firstMessageOrdinal: ordered.length ? ordered[0].ordinal : 0,
    lastMessageOrdinal: ordered.length ? ordered.at(-1).ordinal : 0,
    messageRevision: `sha256:${storageDigest(JSON.stringify(ordered.map(({ message, ordinal, hash }) => [message.messageUid, ordinal, hash])))}`,
  };
}

export function assertSessionStorageMessageIndex(entries, index) {
  const projected = createSessionStorageMessageIndex(entries);
  if (Object.keys(projected).some((key) => projected[key] !== index[key])) {
    throw invalidJournal("materialized messages do not match the committed index");
  }
  return entries;
}
