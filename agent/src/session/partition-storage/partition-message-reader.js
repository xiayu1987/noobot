/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDialogAnchorMessageRecord, projectTurnMessage } from "@noobot/session-protocol";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  partitionMessageEntryKey,
  readPartitionMessagePositionVisibility as readMessagePositionVisibility,
  readPartitionSessionMessageCount as readSessionMessageCount,
  requirePartitionMessageTurnOwnership,
  requirePartitionVisibleMessageTurnOwnership,
  resolvePartitionMessageSuffix,
  resolvePartitionReplacementSuffix,
} from "@noobot/session-protocol/partition-session-messages";
import {
  messageReadJsonBytes,
  sessionMessagePageLength,
} from "@noobot/session-protocol/message-read-budget";
import {
  advancePartitionContentRange,
  requirePartitionContentRange,
} from "@noobot/session-protocol/partition-message-content";
import { checkPartitionMessageStorage } from "./partition-message-record.js";

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

export function checkMessage(
  record,
  { snapshot, scope, generation, indexed = false, ...identity },
) {
  const { messageUid, dialogProcessId, turnScopeId, turnOrdinal } = identity;
  checkPartitionMessageStorage(record, { snapshot, scope, messageUid, generation });
  if (
    (dialogProcessId !== undefined && record.message.dialogProcessId !== dialogProcessId) ||
    (turnScopeId !== undefined && record.message.turnScopeId !== turnScopeId)
  ) {
    if (indexed) corrupt("Turn order references a message outside its turn");
    throw new PartitionAdmissionRejection(
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
      "Message belongs to another turn",
    );
  }
  if (turnOrdinal !== undefined && record.turnOrdinal !== turnOrdinal)
    corrupt("Turn order references a message at the wrong position");
  return record;
}

function pageKeys({ collection, id, count, after, limit, firstOrdinal = 1 }) {
  const length = sessionMessagePageLength(after, count, limit);
  const keys = [];
  for (let index = 0; index < length; index += 1)
    keys.push(partitionMessageEntryKey(collection, id, firstOrdinal + after + index));
  return keys;
}

async function readMessageChunkRanges(read, record, after, limit) {
  const count = record.lastChunk - record.firstChunk + 1;
  const keys = pageKeys({
    collection: collections.content,
    id: record.message.messageUid,
    count,
    after,
    limit,
    firstOrdinal: record.firstChunk,
  });
  const values = await read({ collection: collections.content, keys });
  const ranges = keys.map((key) => requirePartitionContentRange(values.get(key)?.value, record));
  return { ranges, hasMore: after + ranges.length < count };
}

export async function readMessageChunks(read, record, after, limit) {
  const { ranges, hasMore } = await readMessageChunkRanges(read, record, after, limit);
  return { entries: ranges.map(({ content }) => content), hasMore };
}

export async function materializeMessage(
  read,
  { snapshot, record, lifecycle, budget, selectContent },
) {
  const message = projectTurnMessage(record.message, lifecycle);
  budget.consume("bytes", messageReadJsonBytes(message));
  if (selectContent && !selectContent(message)) return { ...message, content: null };
  budget.consume("bytes", record.contentBytes);
  return { ...message, content: await readPartitionMessageBody(read, snapshot, record) };
}

export async function readPartitionMessageBody(read, snapshot, record) {
  const chunks = [];
  let offset = 1;
  let hasMore;
  do {
    const page = await readMessageChunkRanges(
      read,
      record,
      chunks.length,
      snapshot.limits.pageRecords,
    );
    hasMore = page.hasMore;
    for (const [index, range] of page.ranges.entries()) {
      const last = !hasMore && index === page.ranges.length - 1;
      offset = advancePartitionContentRange(range, offset, record.contentBytes, last);
      chunks.push(range.content);
    }
  } while (hasMore);
  return chunks.join("");
}

export async function readSessionOrderRecords({
  read,
  snapshot,
  scope,
  generation = snapshot.sequence,
  page,
  limit,
  count,
  firstOrdinal = 1,
}) {
  const keys = pageKeys({
    collection: collections.sessionOrder,
    id: snapshot.sessionId,
    count,
    after: page.after,
    limit,
    firstOrdinal,
  });
  return readSessionOrderKeys(
    { read, snapshot, scope, generation },
    keys,
    firstOrdinal + page.after,
  );
}

export async function readSessionOrderRecord(identity, ordinal) {
  const key = partitionMessageEntryKey(
    collections.sessionOrder,
    identity.snapshot.sessionId,
    ordinal,
  );
  const [record] = await readSessionOrderKeys(identity, [key], ordinal);
  return record;
}

async function readSessionOrderKeys(
  { read, snapshot, scope, generation = snapshot.sequence },
  keys,
  firstOrdinal,
) {
  const order = await read({ collection: collections.sessionOrder, keys });
  const entries = keys.map((key) => {
    const uid = order.get(key)?.value;
    if (typeof uid !== "string" || !uid) corrupt("Missing partition session message order entry");
    return uid;
  });
  const records = await read({ collection: collections.messages, keys: [...new Set(entries)] });
  return entries.map((messageUid, index) => {
    const record = checkMessage(records.get(messageUid)?.value, {
      snapshot,
      scope,
      messageUid,
      generation,
    });
    if (record.sessionOrdinal !== firstOrdinal + index)
      corrupt("Session order references a message at the wrong position");
    return record;
  });
}

export async function readSessionOrderEntries(query) {
  const records = await readSessionOrderRecords(query);
  await requirePartitionVisibleMessageTurnOwnership(query.read, records);
  return records.map(({ message }) => message.messageUid);
}

export async function readVisibleMessagePosition(read, sessionId, record) {
  const count = await readSessionMessageCount(read);
  const [visible] = await readMessagePositionVisibility(read, sessionId, count, {
    records: [record],
  });
  if (!visible) return null;
  const { lifecycle } = await requirePartitionVisibleMessageTurnOwnership(read, [record]);
  return { record, lifecycle: lifecycle.get(record.message.turnScopeId) };
}

export async function readPartitionSuffixAnchor(
  { read, snapshot, scope, turnScopeId, generation },
  replacement = false,
) {
  const { turns } = await requirePartitionMessageTurnOwnership(read, [{ turnScopeId }]);
  const turn = turns.get(turnScopeId);
  if (turn === null || turn.mutation.remove) return null;
  const { dialogProcessId } = turn.mutation.value;
  const identity = { snapshot, scope, dialogProcessId, turnScopeId, generation };
  const record = await readTurnPosition(read, identity, 1);
  const count = await readSessionMessageCount(read);
  const [visible] = await readMessagePositionVisibility(read, scope.sessionId, count, {
    records: [record],
    conflict: "Suffix anchor disagrees with session order",
  });
  if (!visible) return null;
  if (!replacement) return resolvePartitionMessageSuffix(snapshot, record, count);
  const uid = isDialogAnchorMessageRecord(record.message)
    ? record.message.messageUid
    : record.previousDialogUserUid;
  if (uid === null) return null;
  const candidate =
    uid === record.message.messageUid
      ? record
      : checkMessage(
          (await read({ collection: collections.messages, keys: [uid] })).get(uid)?.value,
          { snapshot, scope, generation, messageUid: uid, dialogProcessId, indexed: true },
        );
  const suffix = resolvePartitionReplacementSuffix({
    snapshot,
    first: record,
    candidate,
    indexedMessageUid: uid,
    count,
  });
  if (!(await readVisibleMessagePosition(read, scope.sessionId, candidate)))
    corrupt("Partition replacement user anchor is not visible");
  return { ...suffix, anchorMessage: candidate.message };
}

export async function readTurnPosition(read, identity, turnOrdinal) {
  const { snapshot, scope, dialogProcessId, turnScopeId, generation } = identity;
  const key = partitionMessageEntryKey(collections.order, turnScopeId, turnOrdinal);
  const messageUid = (await read({ collection: collections.order, keys: [key] })).get(key)?.value;
  if (typeof messageUid !== "string" || !messageUid) corrupt("Missing partition turn order entry");
  const anchor = (await read({ collection: collections.messages, keys: [messageUid] })).get(
    messageUid,
  );
  return checkMessage(anchor?.value, {
    snapshot,
    scope,
    messageUid,
    dialogProcessId,
    turnScopeId,
    turnOrdinal,
    generation,
    indexed: true,
  });
}

export async function readMaterializedTurnWindow({
  read,
  identity,
  after,
  length,
  lifecycle,
  budget,
  selectContent,
}) {
  return read.readWindow(length, async (index) => {
    const {
      records: [record],
    } = await readTurnWindow(read, identity, after + index, 1);
    const { sessionOrdinal: ordinal, turnOrdinal } = record;
    budget.consume("bytes", messageReadJsonBytes({ ordinal, turnOrdinal }));
    const message = await materializeMessage(read, {
      snapshot: identity.snapshot,
      record,
      lifecycle,
      budget,
      selectContent,
    });
    return { ordinal, turnOrdinal, message };
  });
}

export async function readTurnWindow(read, identity, after, length) {
  if (!length) return { records: [] };
  const { scope, turnScopeId } = identity;
  const keys = pageKeys({
    collection: collections.order,
    id: turnScopeId,
    after,
    count: after + length,
    limit: length,
  });
  const order = await read({ collection: collections.order, keys });
  const uids = keys.map((key) => {
    const uid = order.get(key)?.value;
    if (typeof uid !== "string" || !uid) corrupt("Missing partition turn order entry");
    return uid;
  });
  if (new Set(uids).size !== uids.length) corrupt("Duplicate partition turn order entry");
  const owners = await read({ collection: collections.messages, keys: uids, includeOwner: true });
  const records = uids.map((messageUid, index) =>
    checkMessage(owners.get(messageUid)?.mutation.value, {
      ...identity,
      messageUid,
      turnOrdinal: after + index + 1,
      indexed: true,
    }),
  );
  const count = await readSessionMessageCount(read);
  const visibility = await readMessagePositionVisibility(read, scope.sessionId, count, { records });
  if (visibility.includes(false)) corrupt("Partition turn tail references a hidden message");
  return { records, owners };
}
