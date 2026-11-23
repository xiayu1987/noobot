/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { recordStorageWork } from "../session-storage-observation.js";

const messageBytes = new WeakMap();
const projectionSizes = new WeakMap();
const entryMetadataBytes = new WeakMap();
const additionalSizes = new WeakMap();

function retainedMessageBytes(message) {
  let bytes = messageBytes.get(message);
  if (bytes === undefined) {
    bytes = Buffer.byteLength(JSON.stringify(message));
    messageBytes.set(message, bytes);
  }
  return bytes;
}

function retainedEntryMetadataBytes(entry) {
  let bytes = entryMetadataBytes.get(entry);
  if (bytes === undefined) {
    const messageUid = entry.message.messageUid;
    bytes =
      Buffer.byteLength(JSON.stringify([messageUid, entry.hash])) +
      Buffer.byteLength(JSON.stringify({ messageUid, ordinal: entry.ordinal }));
    entryMetadataBytes.set(entry, bytes);
    recordStorageWork("projectionMetadataMessages");
  }
  return bytes;
}

function rebuildCommittedProjection(entries) {
  recordStorageWork("projectionRebuiltMessages", entries.length);
  return {
    messages: new Map(entries.map(({ message }) => [message.messageUid, message])),
    hashes: new Map(entries.map(({ message, hash }) => [message.messageUid, hash])),
    positions: entries.map(({ message, ordinal }) => ({ messageUid: message.messageUid, ordinal })),
  };
}

function lazyCommittedProjection(entries) {
  let materialized;
  const state = {};
  for (const field of ["messages", "hashes", "positions"]) {
    Object.defineProperty(state, field, {
      get() {
        materialized ??= rebuildCommittedProjection(entries);
        return materialized[field];
      },
    });
  }
  return state;
}

function metadataOverhead(count) {
  return 7 + Math.max(0, count - 1) * 2;
}

function committedSize(entries, previous, changes) {
  const prior = previous && projectionSizes.get(previous.state);
  let messageSize = prior ? prior.messageSize : 0;
  let metadataSize = prior
    ? prior.metadataSize +
      metadataOverhead(entries.length) -
      metadataOverhead(changes.previousEntries.length)
    : metadataOverhead(entries.length);
  const added = prior ? changes.added : entries;
  const removed = prior ? changes.removed : [];
  recordStorageWork(
    prior ? "projectionDeltaEntries" : "projectionSizeMessages",
    added.length + removed.length,
  );
  for (const entry of added) {
    messageSize += retainedMessageBytes(entry.message);
    metadataSize += retainedEntryMetadataBytes(entry);
  }
  for (const entry of removed) {
    messageSize -= retainedMessageBytes(entry.message);
    metadataSize -= retainedEntryMetadataBytes(entry);
  }
  let messages;
  return {
    messageSize,
    metadataSize,
    get messages() {
      messages ??= new Set(entries.map((entry) => entry.message));
      return messages;
    },
  };
}

function additionalMessageBytes(state, checkpointState) {
  if (state === checkpointState) return 0;
  const cached = additionalSizes.get(state);
  if (cached?.checkpointState === checkpointState) return cached.bytes;
  const checkpoint = projectionSize(checkpointState);
  const current = projectionSize(state);
  let bytes = 0;
  recordStorageWork("projectionSizeMessages", current.messages.size);
  for (const message of current.messages)
    if (!checkpoint.messages.has(message)) bytes += retainedMessageBytes(message);
  additionalSizes.set(state, { checkpointState, bytes });
  return bytes;
}

export function committedProjection(entries, previous, changes) {
  const reusable = previous && changes?.previousEntries === previous.materializedEntries;
  if (reusable && entries === previous.materializedEntries) return previous.state;
  const state = lazyCommittedProjection(entries);
  projectionSizes.set(state, committedSize(entries, reusable ? previous : null, changes));
  if (!reusable) return state;
  const checkpointState = previous.checkpointState;
  const checkpoint = projectionSize(checkpointState);
  let bytes = additionalMessageBytes(previous.state, checkpointState);
  for (const entry of changes.added)
    if (!checkpoint.messages.has(entry.message)) bytes += retainedMessageBytes(entry.message);
  for (const entry of changes.removed)
    if (!checkpoint.messages.has(entry.message)) bytes -= retainedMessageBytes(entry.message);
  additionalSizes.set(state, { checkpointState, bytes });
  return state;
}

function projectionSize(projection) {
  const cached = projectionSizes.get(projection);
  if (cached) return cached;
  const messages = new Set(projection.messages.values());
  let messageSize = 0;
  recordStorageWork("projectionSizeMessages", messages.size);
  for (const message of messages) messageSize += retainedMessageBytes(message);
  const size = {
    messages,
    messageSize,
    metadataSize: Buffer.byteLength(JSON.stringify([[...projection.hashes], projection.positions])),
  };
  projectionSizes.set(projection, size);
  return size;
}

export function invalidateProjectionSize(state) {
  projectionSizes.delete(state);
  additionalSizes.delete(state);
}

export function retainedBytes(chain, state) {
  const checkpoint = projectionSize(chain.checkpointState);
  const current = projectionSize(state);
  return (
    Buffer.byteLength(JSON.stringify(chain.links)) +
    checkpoint.metadataSize +
    current.metadataSize +
    checkpoint.messageSize +
    6 +
    additionalMessageBytes(state, chain.checkpointState)
  );
}
