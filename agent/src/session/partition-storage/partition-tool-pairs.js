/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { summaryCheckpointToolPairMemberships } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  createPartitionToolPairReader,
  PARTITION_TOOL_PAIRS,
  partitionToolPairKey,
  partitionToolPairResultKey,
  readPartitionVisibleToolPair,
} from "@noobot/session-protocol/partition-tool-pairs";
import { readPartitionSessionMessageCount } from "@noobot/session-protocol/partition-session-messages";
import { createPartitionMutationReader } from "@noobot/session-protocol/partition-transaction";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";

const collection = PARTITION_TOOL_PAIRS.pairs;

function createMemberChecker(checkMessage) {
  return (record, messageUid, identity, role) => {
    const checked = checkMessage(record, messageUid);
    if (summaryCheckpointToolPairMemberships(checked.message).get(identity) !== role)
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Tool pair membership disagrees");
    return checked;
  };
}

export async function readPartitionToolPairAt({ journal, scope, snapshot, key, identity }) {
  const transactions = new PartitionSessionTransactions(journal, scope);
  const read = (query) => transactions.read(snapshot, (readCollection) => readCollection(query));
  const stored = (await read({ collection, keys: [key] })).get(key);
  if (stored === null) return null;
  const value = stored.value;
  if (typeof value?.identity !== "string" || partitionToolPairKey(value.identity) !== key)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition tool pair key");
  const checkMember = createMemberChecker((record, messageUid) =>
    checkPartitionMessageStorage(record, {
      snapshot,
      scope,
      messageUid,
      generation: snapshot.sequence,
    }),
  );
  const reader = createPartitionToolPairReader({
    read,
    checkMember,
    identity: identity ?? value.identity,
    value,
    count: await readPartitionSessionMessageCount(read),
    sessionId: scope.sessionId,
  });
  return { header: await reader.readHeader(), visitResults: reader.visitResults };
}

export async function readPartitionToolPairs(view, identities) {
  if (!identities.length) return new Map();
  const keys = identities.map(partitionToolPairKey);
  const { read } = view;
  const values = await read({ collection, keys });
  const count = await readPartitionSessionMessageCount(read);
  const pairs = new Map();
  for (const [index, identity] of identities.entries()) {
    const value = values.get(keys[index])?.value;
    pairs.set(
      identity,
      await readPartitionVisibleToolPair({
        read,
        identity,
        value,
        count,
        sessionId: view.sessionId,
        checkMember: createMemberChecker(view.checkMessage),
      }),
    );
  }
  return pairs;
}

function applyMembership(value, { role, messageUid }) {
  if (role !== "declaration") {
    value.resultCount += 1;
    if (!Number.isSafeInteger(value.resultCount))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid tool result count");
    return;
  }
  if (value.ownerUid)
    throw new PartitionAdmissionRejection(
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
      "Tool call already has a declaration",
    );
  value.ownerUid = messageUid;
}

function groupMemberships(messages) {
  const changes = new Map();
  for (const message of messages) {
    for (const [identity, role] of summaryCheckpointToolPairMemberships(message)) {
      const key = partitionToolPairKey(identity);
      const entries = changes.get(key) ?? [];
      entries.push({ identity, role, messageUid: message.messageUid });
      changes.set(key, entries);
    }
  }
  return changes;
}

function applyMembershipChanges(value, entries, mutations) {
  for (const entry of entries) {
    applyMembership(value, entry);
    if (entry.role === "result")
      mutations.push({
        collection: PARTITION_TOOL_PAIRS.results,
        key: partitionToolPairResultKey(value.identity, value.resultCount),
        value: entry.messageUid,
        owner: null,
      });
  }
}

export async function preparePartitionToolPairCreations({ view, messages, snapshot, scope }) {
  const changes = groupMemberships(messages);
  if (!changes.size) return [];
  const stored = await view.getLatestMany({ collection, keys: [...changes.keys()] });
  const read = createPartitionMutationReader(view.getLatestMany);
  const count = await readPartitionSessionMessageCount(read);
  const checkMessage = (record, messageUid) =>
    checkPartitionMessageStorage(record, {
      snapshot,
      scope,
      messageUid,
      generation: view.generation,
    });
  const mutations = [];
  for (const [key, entries] of changes) {
    const current = stored.get(key);
    const { identity } = entries[0];
    const value =
      current && !current.mutation.remove
        ? await readPartitionVisibleToolPair({
            read,
            identity,
            value: current.mutation.value,
            count,
            sessionId: scope.sessionId,
            checkMember: createMemberChecker(checkMessage),
          })
        : { identity, ownerUid: "", resultCount: 0 };
    if (entries.some((entry) => entry.identity !== identity))
      throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition tool pair");
    applyMembershipChanges(value, entries, mutations);
    mutations.push({ collection, key, owner: current ? current.owner : null, value });
  }
  const positions = mutations.filter(
    ({ collection }) => collection === PARTITION_TOOL_PAIRS.results,
  );
  if (positions.length) {
    const owners = await view.getCreationOwners({
      collection: PARTITION_TOOL_PAIRS.results,
      keys: positions.map(({ key }) => key),
    });
    for (const position of positions) position.owner = owners.get(position.key);
  }
  return mutations;
}
