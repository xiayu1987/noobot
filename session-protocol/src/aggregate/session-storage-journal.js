/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepFrozen } from "@noobot/shared/deep-freeze";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { storageDigest, createStorageDigest } from "#storage-digest";
import { SESSION_ERROR_CODE } from "../errors.js";
import {
  prepareMessageIndexValidation,
  commitMessageIndexValidation,
} from "./session-storage-index-validation.js";

export const SESSION_STORAGE_JOURNAL_OP = Object.freeze({
  UPSERT: "upsert",
  REMOVE: "remove",
  ORDER: "order",
  APPEND_POSITIONS: "append_positions",
});

const immutableMessageHashes = new WeakMap();
const immutableMessageIndexes = new WeakMap();
const validatedPositions = new WeakSet();

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

function collectPositionIdentity(messageUid, ordinal, identities, ordinals) {
  if (!isCanonicalText(messageUid)) throw invalidJournal("messageUid is required");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw invalidJournal("ordinal must be a positive integer");
  if (identities.has(messageUid) || ordinals.has(ordinal))
    throw invalidJournal("duplicate message identity or ordinal");
  identities.add(messageUid);
  ordinals.add(ordinal);
}

export function assertSessionMessagePositions(positions) {
  if (!Array.isArray(positions)) throw invalidJournal("positions must be an array");
  if (validatedPositions.has(positions)) return positions;
  const identities = new Set();
  const ordinals = new Set();
  for (const position of positions) {
    if (!isPlainObject(position)) throw invalidJournal("position must be an object");
    requireOnlyFields(position, ["messageUid", "ordinal"]);
    collectPositionIdentity(position.messageUid, position.ordinal, identities, ordinals);
  }
  if (isDeepFrozen(positions)) validatedPositions.add(positions);
  return positions;
}

export function assertSessionStorageJournalRecord(record) {
  if (!isPlainObject(record)) throw invalidJournal("record must be an object");
  if (
    record.op === SESSION_STORAGE_JOURNAL_OP.ORDER ||
    record.op === SESSION_STORAGE_JOURNAL_OP.APPEND_POSITIONS
  ) {
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

export function compactSessionStorageJournalRecords(records) {
  if (!Array.isArray(records)) throw invalidJournal("records must be an array");
  const latest = new Map();
  let order;
  let positions = [];
  for (const record of records) {
    assertSessionStorageJournalRecord(record);
    if (record.op === SESSION_STORAGE_JOURNAL_OP.ORDER) {
      order = record.op;
      positions = [...record.positions];
    } else if (record.op === SESSION_STORAGE_JOURNAL_OP.APPEND_POSITIONS) {
      order ||= record.op;
      positions.push(...record.positions);
    } else latest.set(record.messageUid, record);
  }
  if (order) assertSessionMessagePositions(positions);
  return order ? [...latest.values(), { op: order, positions }] : [...latest.values()];
}

export function createSessionStorageJournalProjection() {
  return { messages: new Map(), hashes: new Map(), positions: [] };
}

function appendPositions(target, positions) {
  for (const position of positions) target.push({ ...position });
}

export function applySessionStorageJournalRecords(projection, records) {
  if (!Array.isArray(records)) throw invalidJournal("records must be an array");
  for (const record of records) {
    assertSessionStorageJournalRecord(record);
    if (record.op === SESSION_STORAGE_JOURNAL_OP.ORDER) {
      projection.positions = record.positions.map((position) => ({ ...position }));
    } else if (record.op === SESSION_STORAGE_JOURNAL_OP.APPEND_POSITIONS) {
      appendPositions(projection.positions, record.positions);
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

function indexDigest(ordered, previous, verifiedPrefix) {
  let prefix = verifiedPrefix ?? 0;
  if (verifiedPrefix === undefined)
    while (prefix < ordered.length && ordered[prefix] === previous?.ordered[prefix]) prefix += 1;
  const reusable = previous?.prefixes.findLast((item) => item.offset <= prefix);
  const digest = reusable ? reusable.digest.copy() : createStorageDigest().update("[");
  const boundary = previous?.prefixes.findLast(
    (item) => item.offset <= (reusable?.offset || 0) && item.offset % 64 === 0,
  );
  const prefixes = boundary ? [boundary] : [];
  for (let offset = reusable?.offset || 0; offset < ordered.length; offset += 1) {
    const { message, ordinal, hash } = ordered[offset];
    digest.update(`${offset ? "," : ""}${JSON.stringify([message.messageUid, ordinal, hash])}`);
    if ((offset + 1) % 64 === 0)
      prefixes.splice(0, prefixes.length, { offset: offset + 1, digest: digest.copy() });
  }
  if (!prefixes.length || prefixes.at(-1).offset !== ordered.length)
    prefixes.push({ offset: ordered.length, digest: digest.copy() });
  return { prefixes, messageRevision: `sha256:${digest.update("]").digest("hex")}` };
}

export function createSessionStorageMessageIndex(entries, previousEntries) {
  const cached = immutableMessageIndexes.get(entries);
  if (cached) return { ...cached.index };
  const previous = immutableMessageIndexes.get(previousEntries);
  const prepared = prepareMessageIndexValidation(entries, previous);
  const { ordered } = prepared;
  const { prefixes, messageRevision } = indexDigest(ordered, previous, prepared.prefix);
  const index = {
    messageCount: ordered.length,
    firstMessageOrdinal: ordered.length ? ordered[0].ordinal : 0,
    lastMessageOrdinal: ordered.length ? ordered.at(-1).ordinal : 0,
    messageRevision,
  };
  if (isDeepFrozen(entries)) {
    const validation = commitMessageIndexValidation(prepared);
    immutableMessageIndexes.set(entries, { index, ordered, prefixes, validation });
  }
  return { ...index };
}

export function assertSessionStorageMessageIndex(entries, index) {
  const projected = createSessionStorageMessageIndex(entries);
  if (Object.keys(projected).some((key) => projected[key] !== index[key])) {
    throw invalidJournal("materialized messages do not match the committed index");
  }
  return entries;
}
