/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { deepFreeze, deepFreezeArray, isDeepFrozen } from "@noobot/shared/deep-freeze";
import { messageHash } from "./turn-journal-store.js";

function committedEntry(message, ordinal, previousEntry) {
  const hash = previousEntry?.message === message ? previousEntry.hash : messageHash(message);
  if (previousEntry?.hash === hash && previousEntry.ordinal === ordinal) return previousEntry;
  let committedMessage = message;
  if (previousEntry?.hash === hash) committedMessage = previousEntry.message;
  else if (!isDeepFrozen(message)) committedMessage = deepFreeze(structuredClone(message));
  return deepFreeze({ message: committedMessage, ordinal, hash });
}

function appendRemovals(previousEntries, materializedEntries, { previousByUid, records, removed }) {
  if (!previousByUid) {
    for (let index = materializedEntries.length; index < previousEntries.length; index += 1) {
      records.push({ op: "remove", messageUid: previousEntries[index].message.messageUid });
      removed.push(previousEntries[index]);
    }
    return;
  }
  const nextUids = new Set(materializedEntries.map(({ message }) => message.messageUid));
  for (const entry of previousEntries) {
    if (nextUids.has(entry.message.messageUid)) continue;
    records.push({ op: "remove", messageUid: entry.message.messageUid });
    removed.push(entry);
  }
}

function appendPositionChanges(records, turn, previousEntries, prefixUnchanged) {
  if ((!previousEntries.length && turn.positions.length) || !prefixUnchanged)
    records.push({ op: "order", positions: turn.positions });
  else if (turn.positions.length > previousEntries.length)
    records.push({
      op: "append_positions",
      positions: turn.positions.slice(previousEntries.length),
    });
}

function entryPositionChanged(entry, aligned) {
  return (
    aligned &&
    (entry.message.messageUid !== aligned.message.messageUid || entry.ordinal !== aligned.ordinal)
  );
}

function collectEntryChanges(entry, previous, { added, removed }) {
  if (entry === previous) return;
  added.push(entry);
  if (previous) removed.push(previous);
}

export function diffTurnEntries(turn, previousEntries) {
  let previousByUid;
  let prefixUnchanged = previousEntries.length <= turn.messages.length;
  const records = [];
  const added = [];
  const removed = [];
  const changes = { previousEntries, added, removed };
  let materializedEntries;
  for (let index = 0; index < turn.messages.length; index += 1) {
    const message = turn.messages[index];
    const aligned = previousEntries[index];
    const ordinal = turn.positions[index].ordinal;
    if (!previousByUid && aligned?.message === message && aligned.ordinal === ordinal) {
      materializedEntries?.push(aligned);
      continue;
    }
    if (aligned && aligned.message.messageUid !== message.messageUid) {
      previousByUid ??= new Map(previousEntries.map((entry) => [entry.message.messageUid, entry]));
    }
    const previous = previousByUid ? previousByUid.get(message.messageUid) : aligned;
    const entry = committedEntry(message, ordinal, previous);
    collectEntryChanges(entry, previous, changes);
    if (entryPositionChanged(entry, aligned)) prefixUnchanged = false;
    if (entry.hash !== previous?.hash)
      records.push({ op: "upsert", messageUid: message.messageUid, message, hash: entry.hash });
    if (!materializedEntries && entry !== aligned)
      materializedEntries = previousEntries.slice(0, index);
    if (materializedEntries) materializedEntries.push(entry);
  }
  materializedEntries ??=
    turn.messages.length === previousEntries.length
      ? previousEntries
      : previousEntries.slice(0, turn.messages.length);
  appendRemovals(previousEntries, materializedEntries, { previousByUid, records, removed });
  appendPositionChanges(records, turn, previousEntries, prefixUnchanged);
  return {
    records,
    materializedEntries:
      materializedEntries === previousEntries
        ? previousEntries
        : deepFreezeArray(materializedEntries),
    changes,
  };
}
