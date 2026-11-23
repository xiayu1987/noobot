/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createSessionDisplayStats,
  describeSessionDisplayMessageRow,
  emptySessionDisplayOrderPage,
  emptySessionDisplayRowCounts,
  emptySessionDisplaySourceCounts,
  readSessionDisplayPage,
  readSessionDisplayPublicationWindow,
  requireSessionDisplayStats,
  sessionDisplayDependencyDirectory,
  stageSessionDisplayPublication,
} from "@noobot/session-protocol/session-reader";
import { projectTurnMessage } from "@noobot/session-protocol";
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { messageReadJsonBytes } from "@noobot/session-protocol/message-read-budget";
import {
  readPartitionLifecycleHeader,
  readPartitionTurnState,
} from "@noobot/session-protocol/partition-session-state";
import { countDisplayRowAttachments } from "../session-summary-builders/display-summary-stats.js";
import { requireRetainedJournalSnapshotId } from "./journal-snapshots.js";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { checkMessage } from "./partition-message-reader.js";

const collection = "metadata";
const statisticsKey = "display:statistics";
const orderKey = (prefix) => `display:order:${prefix}`;
const rowKey = (key) => `display:row:${key}`;

export function seedPartitionDisplayPublication() {
  const statistics = createSessionDisplayStats({
    messageCount: 0,
    ...emptySessionDisplaySourceCounts(),
    ...emptySessionDisplayRowCounts(),
    displayToolLogCount: 0,
    unassignedToolArtifactCount: 0,
    conflictedToolArtifactCount: 0,
  });
  return [
    { collection, key: statisticsKey, owner: null, value: statistics },
    { collection, key: orderKey(""), owner: null, value: emptySessionDisplayOrderPage() },
  ];
}

export async function readPartitionDisplayStatistics(read) {
  const entry = (await read({ collection, keys: [statisticsKey] })).get(statisticsKey);
  try {
    return requireSessionDisplayStats(entry?.value);
  } catch (cause) {
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
}

export function stagePartitionDisplayPublication(
  plan,
  { changes, sourceStatistics, artifactAttachmentDelta },
) {
  return stageSessionDisplayPublication(
    {
      getStatistics: () => plan.get(collection, statisticsKey),
      setStatistics: (value) => plan.set(collection, statisticsKey, value),
      getRow: (key) => plan.get(collection, rowKey(key)),
      setRow: (key, value) => plan.set(collection, rowKey(key), value),
      removeRow: (key) => plan.remove(collection, rowKey(key)),
      order: {
        get: (prefix) => plan.get(collection, orderKey(prefix)),
        set: (prefix, value) => plan.set(collection, orderKey(prefix), value),
        remove: (prefix) => plan.remove(collection, orderKey(prefix)),
      },
    },
    {
      changes,
      sourceStatistics,
      countAttachments: countDisplayRowAttachments,
      artifactAttachmentDelta,
    },
  );
}

function bindDisplayTurnState(read, identity) {
  let header;
  const states = new Map();
  return (turnScopeId) => {
    if (!states.has(turnScopeId)) {
      header ??= readPartitionLifecycleHeader(read);
      states.set(
        turnScopeId,
        header.then((value) =>
          readPartitionTurnState(read, turnScopeId, value, (record, messageUid) =>
            checkMessage(record, { ...identity, messageUid, indexed: true }),
          ),
        ),
      );
    }
    return states.get(turnScopeId);
  };
}

async function describePartitionDisplayRow(
  { read, identity, readTurnState, readThinkingDetails },
  row,
  jsonBytes,
) {
  if (row.turnPlaceholder === true) {
    if (row.role !== "assistant" || !(await readThinkingDetails(row.turnScopeId)))
      return { jsonBytes, read: () => row };
    const message = { ...row, hasThinkingDetails: true };
    return { jsonBytes: messageReadJsonBytes(message), read: () => message };
  }
  const { messageUid, sessionOrdinal } = row;
  const stored = (
    await read({ collection: PARTITION_MESSAGE_COLLECTIONS.messages, keys: [messageUid] })
  ).get(messageUid);
  const record = checkMessage(stored?.value, {
    ...identity,
    messageUid,
    indexed: true,
  });
  if (record.sessionOrdinal !== sessionOrdinal)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Display message position mismatch");
  const { message } = record;
  return describeSessionDisplayMessageRow(row, {
    message:
      message.role === "assistant"
        ? projectTurnMessage(message, await readTurnState(message.turnScopeId))
        : message,
    hasThinkingDetails:
      message.role === "assistant" && (await readThinkingDetails(message.turnScopeId)),
    contentReference: record.contentVersion,
    contentBytes: record.contentBytes,
  });
}

export function readPartitionDisplayPublicationPage(
  read,
  { journal, snapshot, parentSessionId, aggregateVersion },
  selection,
) {
  const scope = {
    sessionId: snapshot.sessionId,
    parentSessionId,
    snapshotId: requireRetainedJournalSnapshotId(journal, snapshot),
    generation: snapshot.sequence,
    aggregateVersion,
  };
  const get = async (key) => (await read({ collection, keys: [key] })).get(key)?.value ?? null;
  const identity = { snapshot, scope, generation: scope.generation };
  const readTurnState = bindDisplayTurnState(read, identity);
  const thinkingDetails = new Map();
  const readThinkingDetails = (turnScopeId) => {
    if (!thinkingDetails.has(turnScopeId)) {
      const timeline = sessionDisplayDependencyDirectory({ get }, turnScopeId, "timeline");
      thinkingDetails.set(
        turnScopeId,
        timeline.first().then((ordinal) => ordinal !== null),
      );
    }
    return thinkingDetails.get(turnScopeId);
  };
  const rowSource = { read, identity, readTurnState, readThinkingDetails };
  let statistics;
  return readSessionDisplayPage(scope, selection, {
    async readStatistics(retained) {
      statistics = await readPartitionDisplayStatistics(read);
      return { ...retained, stats: statistics };
    },
    async readWindow(retained, bounds) {
      const { messages } = await readSessionDisplayPublicationWindow(
        {
          getStatistics: () => statistics,
          getRow: (key) => get(rowKey(key)),
          describeRow: (row, jsonBytes) => describePartitionDisplayRow(rowSource, row, jsonBytes),
          order: { get: (prefix) => get(orderKey(prefix)) },
        },
        bounds,
      );
      return { ...retained, after: bounds.after, messages };
    },
  });
}
