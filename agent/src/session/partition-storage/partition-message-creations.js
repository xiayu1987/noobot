/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { matchesSessionScopeIdentity } from "@noobot/session-protocol";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  PARTITION_MESSAGE_COLLECTIONS as collections,
  PARTITION_SESSION_MESSAGE_COUNT,
  requirePartitionSessionMessageCount as requireMessageCount,
  partitionMessageEntryKey,
  partitionMessageContentVersion,
  requirePartitionMessageTurnOwnership,
  readPartitionMessagePositionVisibility as readMessagePositionVisibility,
} from "@noobot/session-protocol/partition-session-messages";
import {
  preparePartitionDialogs,
  requireFreshPartitionMessageIdentities,
} from "@noobot/session-protocol/partition-session-dialogs";
import { createPartitionMutationReader } from "@noobot/session-protocol/partition-transaction";
import { encodePartitionContentChunk } from "@noobot/session-protocol/partition-message-content";
import { partitionContentMutations } from "./partition-message-content.js";
import { readTurnPosition } from "./partition-message-reader.js";
import { observePartitionCommitPhase } from "./partition-commit-observation.js";

function nextOrdinal(ordinal) {
  if (!Number.isSafeInteger(ordinal + 1))
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Invalid partition message ordinal");
  return ordinal + 1;
}

function set(collection, key, value, owner = null) {
  return { collection, key, value, owner };
}

function addMessage({
  scope,
  message,
  turns,
  mutations,
  contentVersion,
  sessionOrdinal,
  previousDialogUserUid,
}) {
  const { messageUid, dialogProcessId, turnScopeId, content, ...metadata } = message;
  if (!matchesSessionScopeIdentity(message, scope))
    throw new PartitionAdmissionRejection(
      "SESSION_MESSAGE_IDENTITY_CONFLICT",
      "Message creation identity conflict",
    );
  const turn = turns.get(turnScopeId);
  if (turn.dialogProcessId !== dialogProcessId)
    throw new PartitionAdmissionRejection(
      "SESSION_TURN_IDENTITY_CONFLICT",
      "Turn belongs to another dialog",
    );
  const turnOrdinal = nextOrdinal(turn.messageCount);
  turns.set(turnScopeId, { ...turn, messageCount: turnOrdinal });
  const contentMutations = partitionContentMutations(messageUid, 1, content, 1);
  const record = {
    message: { messageUid, dialogProcessId, turnScopeId, ...metadata },
    sessionOrdinal,
    previousDialogUserUid,
    turnOrdinal,
    firstChunk: 1,
    firstByteChunk: content.length ? 1 : null,
    lastChunk: contentMutations.length,
    contentBytes: encodePartitionContentChunk(content).byteLength + 2,
    contentVersion,
  };
  const turnPosition = set(
    collections.order,
    partitionMessageEntryKey(collections.order, turnScopeId, turnOrdinal),
    messageUid,
  );
  const sessionPosition = set(
    collections.sessionOrder,
    partitionMessageEntryKey(collections.sessionOrder, scope.sessionId, sessionOrdinal),
    messageUid,
  );
  mutations.push(
    set(collections.messages, messageUid, record),
    turnPosition,
    ...contentMutations,
    sessionPosition,
  );
  return { turnPosition, sessionPosition };
}

async function bindMessagePositionOwners(view, collection, positions) {
  if (!positions.length) return;
  const owners = await view.getCreationOwners({
    collection,
    keys: positions.map(({ key }) => key),
  });
  for (const position of positions) position.owner = owners.get(position.key);
}

async function prepareTurnTails(read, state, { messages, records }) {
  const scopes = new Map(
    messages.map(({ turnScopeId, dialogProcessId }) => [turnScopeId, dialogProcessId]),
  );
  const tails = [];
  for (const [turnScopeId, dialogProcessId] of scopes) {
    const record = records.get(turnScopeId);
    if (record?.mutation.remove)
      throw new PartitionAdmissionRejection(
        "SESSION_ENTITY_EXISTS",
        "Turn identity is already allocated",
      );
    const messageCount = record === null ? 0 : record.mutation.value.messageCount;
    if (messageCount > 0) {
      const { snapshot, scope, generation } = state;
      tails.push(
        await readTurnPosition(
          read,
          { snapshot, scope, dialogProcessId, turnScopeId, generation: generation - 1 },
          messageCount,
        ),
      );
    }
    state.turns.set(turnScopeId, {
      dialogProcessId,
      messageCount,
      owner: record === null ? null : record.owner,
    });
  }
  return tails;
}

export async function prepareMessageCreations(
  view,
  read,
  state,
  { messages, contentVersion, records, sourceDialog },
) {
  if (!messages.length) return;
  await observePartitionCommitPhase("messageIdentityAdmission", () =>
    requireFreshPartitionMessageIdentities(view, messages),
  );
  const { collection, key } = PARTITION_SESSION_MESSAGE_COUNT;
  const current = (await view.getLatestMany({ collection, keys: [key] })).get(key);
  let count = requireMessageCount(current?.mutation.value);
  const tails = await prepareTurnTails(read, state, { messages, records });
  if (tails.length) {
    const visible = await readMessagePositionVisibility(read, state.scope.sessionId, count, {
      records: tails,
    });
    if (visible.includes(false))
      throw partitionJournalError(
        "SESSION_STORAGE_CORRUPT",
        "Turn tail disagrees with session message order",
      );
  }
  const dialogMutations = [];
  const predecessors = await preparePartitionDialogs(view, {
    messages,
    turns: records,
    mutations: dialogMutations,
    sourceDialog,
  });
  const sessionPositions = [];
  const reusableTurnPositions = [];
  for (const message of messages) {
    count = nextOrdinal(count);
    const { sessionPosition, turnPosition } = addMessage({
      ...state,
      message,
      contentVersion: contentVersion(),
      sessionOrdinal: count,
      previousDialogUserUid: predecessors.get(message.messageUid),
    });
    sessionPositions.push(sessionPosition);
    if (records.get(message.turnScopeId) !== null) reusableTurnPositions.push(turnPosition);
  }
  await observePartitionCommitPhase("messagePositionAdmission", async () => {
    await bindMessagePositionOwners(view, collections.sessionOrder, sessionPositions);
    await bindMessagePositionOwners(view, collections.order, reusableTurnPositions);
  });
  state.mutations.push(set(collection, key, count, current.owner));
  state.mutations.push(...dialogMutations);
}

export async function prepareReplacementMessage({
  view,
  scope,
  snapshot,
  message,
  retainedCount,
  generation,
}) {
  const mutations = [];
  const messages = [message];
  const { turns: records } = await requirePartitionMessageTurnOwnership(
    createPartitionMutationReader(view.getLatestMany),
    messages,
  );
  const predecessors = await preparePartitionDialogs(view, { messages, turns: records, mutations });
  const turns = new Map([
    [message.turnScopeId, { dialogProcessId: message.dialogProcessId, messageCount: 0 }],
  ]);
  const messageCount = nextOrdinal(retainedCount);
  const { sessionPosition } = addMessage({
    scope,
    message,
    turns,
    mutations,
    sessionOrdinal: messageCount,
    previousDialogUserUid: predecessors.get(message.messageUid),
    contentVersion: partitionMessageContentVersion(snapshot.epoch, generation, 0),
  });
  await bindMessagePositionOwners(view, collections.sessionOrder, [sessionPosition]);
  mutations.push(set(collections.turns, message.turnScopeId, turns.get(message.turnScopeId)));
  return { mutations, messageCount };
}
