/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PARTITION_SESSION_ARTIFACT_EVENTS } from "@noobot/session-protocol/partition-collections";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import {
  readPartitionLifecycleHeader,
  readPartitionTurnStates,
} from "@noobot/session-protocol/partition-session-state";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { readPartitionSessionArtifactEventWindow } from "./partition-outbox.js";
import { PartitionTransactions } from "./partition-transactions.js";
import { PartitionSessionTransactions } from "./partition-session-transactions.js";
import { readPartitionReplacement } from "@noobot/session-protocol/partition-turn-visibility";
import { readPartitionSessionAutoTitle } from "./partition-session-title.js";

async function readLifecycle(transactions, snapshot, keys) {
  const header = await transactions.read(snapshot, readPartitionLifecycleHeader);
  const turns = new Map();
  const limit = snapshot.limits.pageRecords;
  for (let offset = 0; offset < keys.length; offset += limit) {
    const page = await transactions.read(snapshot, (read, scope, { generation }) =>
      readPartitionTurnStates(
        read,
        keys.slice(offset, offset + limit),
        header,
        (record, messageUid) =>
          checkPartitionMessageStorage(record, { snapshot, scope, messageUid, generation }),
      ),
    );
    for (const [key, value] of page) turns.set(key, value);
  }
  if (header.activeTurnScopeId && !turns.has(header.activeTurnScopeId))
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing active lifecycle turn");
  return { ...header, turns: Object.fromEntries(turns) };
}

async function readArtifactEvents(transactions, snapshot, ids) {
  const events = [];
  let offset = 0;
  while (offset < ids.length) {
    const window = await transactions.read(snapshot, (read, scope) =>
      readPartitionSessionArtifactEventWindow(read, scope, snapshot, { ids, offset }),
    );
    offset += window.length;
    events.push(...window.filter((event) => event !== null));
  }
  events.sort((left, right) => left.ordinal - right.ordinal);
  return events.map(({ envelope }) => envelope);
}

export async function readPartitionExecutionSource({ journal, snapshot, scope }) {
  const collections = new PartitionTransactions(journal);
  const keys = await collections.readKeysByCollection(snapshot, ["lifecycle"]);
  const { turns } = await readLifecycle(
    new PartitionSessionTransactions(journal, scope),
    snapshot,
    [...keys.get("lifecycle")],
  );
  return { ...scope, turns: Object.values(turns) };
}

export async function readPartitionSessionSource({
  journal,
  snapshot,
  scope,
  messages,
  readMessagePage,
}) {
  const collections = new PartitionTransactions(journal);
  const metadata = await messages.readMetadata({ snapshot });
  const autoTitle = await readPartitionSessionAutoTitle({ journal, snapshot, scope });
  const keys = await collections.readKeysByCollection(snapshot, [
    "lifecycle",
    "replacements",
    "timings",
    PARTITION_SESSION_ARTIFACT_EVENTS,
  ]);
  const replacedTurns = {};
  const turnTimings = [];
  const define = (record, key, value) =>
    Object.defineProperty(record, key, { value, enumerable: true });
  const transactions = new PartitionSessionTransactions(journal, scope);
  const { sequence, activeTurnScopeId, turns } = await readLifecycle(transactions, snapshot, [
    ...keys.get("lifecycle"),
  ]);
  for (const key of keys.get("replacements")) {
    const tombstone = await transactions.read(snapshot, (read) =>
      readPartitionReplacement(
        async (collection, key) =>
          (await read({ collection, keys: [key] })).get(key)?.value ?? null,
        { sessionId: scope.sessionId, turnScopeId: key, lifecycleSequence: sequence },
      ),
    );
    if (tombstone !== null) define(replacedTurns, key, tombstone);
  }
  for (const key of keys.get("timings")) {
    const timing = await messages.readTurnTiming({ snapshot, turnScopeId: key });
    if (timing !== null) turnTimings.push(timing);
  }
  const sessionArtifactEvents = await readArtifactEvents(transactions, snapshot, [
    ...keys.get(PARTITION_SESSION_ARTIFACT_EVENTS),
  ]);
  const records = [];
  let cursor = null;
  do {
    const page = await readMessagePage({ cursor });
    records.push(...page.records.map(({ message }) => message));
    cursor = page.nextCursor;
  } while (cursor !== null);
  return {
    ...metadata,
    ...(autoTitle ? { autoTitle } : {}),
    messages: records,
    turnTimings,
    turnLifecycle: {
      sequence,
      activeTurnScopeId,
      turns,
      replacedTurns,
    },
    sessionArtifactEvents,
  };
}
