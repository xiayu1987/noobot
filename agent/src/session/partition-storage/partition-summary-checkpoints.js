/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isDeepStrictEqual } from "node:util";
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { applyIndexedTurnSummaryCheckpoint } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  createMessagePersistenceReceipt,
  SessionCommitInputError,
} from "@noobot/session-protocol/session-changes";
import {
  partitionCheckpointOrderKey,
  requirePartitionCheckpointTail,
} from "@noobot/session-protocol/partition-summary-checkpoints";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import {
  createPartitionMutationReader,
  partitionEntityKey,
  partitionMutationOwner,
} from "@noobot/session-protocol/partition-transaction";
import {
  readPartitionMessagePositionVisibility,
  readPartitionSessionMessageCount,
  requirePartitionVisibleMessageTurnOwnership,
} from "@noobot/session-protocol/partition-session-messages";
import { readPartitionToolPairs } from "./partition-tool-pairs.js";
import { checkPartitionMessageStorage } from "./partition-message-record.js";
import { readPartitionTurnMembershipVisibility } from "@noobot/session-protocol/partition-turn-visibility";

const checkpointErrors = new Set(
  Object.entries(SESSION_ERROR_CODE)
    .filter(([name]) => name.startsWith("TURN_SUMMARY_CHECKPOINT_"))
    .map(([, code]) => code),
);

function rejectCheckpoint(cause) {
  if (!checkpointErrors.has(cause?.code) && !(cause instanceof SessionCommitInputError))
    throw cause;
  throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), cause, { cause });
}

function corrupt(message) {
  throw partitionJournalError("SESSION_STORAGE_CORRUPT", message);
}

function checkpointView(snapshot, view, mutations, scope) {
  const slots = new Map();
  for (const [slot, { collection, key }] of mutations.entries())
    slots.set(partitionEntityKey(collection, key), slot);
  const read = createPartitionMutationReader(async ({ collection, keys }) => {
    const pairs = keys.map((key) => [key, slots.get(partitionEntityKey(collection, key))]);
    const missing = pairs.filter(([, slot]) => slot === undefined).map(([key]) => key);
    const values = new Map();
    for (let offset = 0; offset < missing.length; offset += view.pageRecords) {
      const entries = await view.getLatestMany({
        collection,
        keys: missing.slice(offset, offset + view.pageRecords),
      });
      for (const [key, entry] of entries) values.set(key, entry);
    }
    for (const [key, slot] of pairs)
      if (slot !== undefined)
        values.set(key, { mutation: mutations[slot], owner: mutations[slot].owner });
    return values;
  });
  return {
    read,
    sessionId: scope.sessionId,
    checkMessage(record, messageUid) {
      return checkPartitionMessageStorage(record, {
        snapshot,
        scope,
        messageUid,
        generation:
          view.generation + (slots.has(partitionEntityKey("messages", messageUid)) ? 1 : 0),
      });
    },
    write(collection, key, value, current) {
      const identity = partitionEntityKey(collection, key);
      const entry = { collection, key, value, owner: current ? current.owner : null };
      const slot = slots.get(identity);
      if (slot === undefined) {
        slots.set(identity, mutations.length);
        mutations.push(entry);
      } else mutations[slot] = entry;
    },
  };
}

async function readCheckpointMessages(view, scope, request) {
  const uids = [
    ...new Set([
      ...request.persistedMessageUids,
      ...request.summarizedMessageUids,
      ...request.retainedMessageUids,
    ]),
  ];
  const records = await view.read({ collection: "messages", keys: uids, includeOwner: true });
  if ([...records.values()].some((entry) => !entry || entry.mutation.remove))
    throw new PartitionAdmissionRejection(
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
      "Checkpoint references a missing message",
    );
  const { read } = view;
  const messages = [...records].map(([uid, entry]) => view.checkMessage(entry.mutation.value, uid));
  if (messages.length) {
    const count = await readPartitionSessionMessageCount(read);
    const visible = await readPartitionMessagePositionVisibility(read, scope.sessionId, count, {
      records: messages,
    });
    if (visible.includes(false))
      throw new PartitionAdmissionRejection(
        SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
        "Checkpoint references a message outside the visible session prefix",
      );
  }
  const { turns, lifecycle } = await requirePartitionVisibleMessageTurnOwnership(read, messages, {
    turnScopeId: request.turnScopeId,
    dialogProcessId: request.dialogProcessId,
  });
  const visibility = await readPartitionTurnMembershipVisibility(
    read,
    new Map([[request.turnScopeId, turns.get(request.turnScopeId)]]),
    view.checkMessage,
  );
  if (!visibility.get(request.turnScopeId))
    throw new PartitionAdmissionRejection(
      SESSION_ERROR_CODE.TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING,
      "Checkpoint target is outside the visible session prefix",
    );
  return { records, turn: lifecycle.get(request.turnScopeId) };
}

async function readCheckpointSession(view, scope, { request, stored }) {
  const { turnScopeId } = request;
  const [heads, lifecycles] = await Promise.all([
    view.read({ collection: "checkpointHeads", keys: [turnScopeId], includeOwner: true }),
    view.read({ collection: "metadata", keys: ["lifecycle"] }),
  ]);
  const storedHeader = heads.get(turnScopeId);
  const header = storedHeader?.mutation.remove ? null : storedHeader;
  const lifecycle = lifecycles.get("lifecycle");
  const receipt = stored?.mutation.remove ? null : stored?.mutation.value;
  if (!lifecycle || (receipt && (!header || receipt.checkpointId !== request.checkpointId)))
    corrupt("Invalid partition checkpoint state");
  const { records, turn } = await readCheckpointMessages(view, scope, request);
  const original = new Map();
  for (const [uid, entry] of records) {
    original.set(uid, entry.mutation.value.message);
  }
  const session = {
    messages: [...original.values()],
    turnLifecycle: {
      ...lifecycle.value,
      turns: turn ? { [turnScopeId]: turn } : {},
    },
    ...(header
      ? {
          turnSummaryCheckpoints: {
            [turnScopeId]: { ...header.mutation.value, receipts: receipt ? [receipt] : [] },
          },
        }
      : {}),
  };
  return { session, original, records, storedHeader, header };
}

async function writeCheckpointMembership(view, { request, result, header }) {
  const { turnScopeId } = request;
  const tail = (
    await view.read({ collection: "turnCheckpoints", keys: [turnScopeId], includeOwner: true })
  ).get(turnScopeId);
  if (!tail && header) corrupt("Missing live checkpoint membership");
  const previousRevision =
    !tail || tail.mutation.remove
      ? null
      : requirePartitionCheckpointTail(tail.mutation.value, result.checkpointRevision - 1);
  const orderKey = partitionCheckpointOrderKey(turnScopeId, result.checkpointRevision);
  const order = (
    await view.read({ collection: "checkpointOrder", keys: [orderKey], includeOwner: true })
  ).get(orderKey);
  if (order && !order.mutation.remove) corrupt("Checkpoint revision already exists");
  view.write(
    "checkpointOrder",
    orderKey,
    { checkpointId: request.checkpointId, previousRevision },
    order,
  );
  view.write("turnCheckpoints", turnScopeId, result.checkpointRevision, tail);
}

async function applyCheckpoint(view, scope, { request, key, committedAt, stored }) {
  const { turnScopeId } = request;
  const { session, original, records, storedHeader, header } = await readCheckpointSession(
    view,
    scope,
    {
      request,
      stored,
    },
  );
  let result;
  try {
    result = await applyIndexedTurnSummaryCheckpoint(session, request, committedAt, (identities) =>
      readPartitionToolPairs(view, identities),
    );
  } catch (cause) {
    rejectCheckpoint(cause);
  }
  if (!result.committed) return { key, turnScopeId, duplicate: result };
  for (const message of session.messages) {
    const uid = message.messageUid;
    if (message === original.get(uid)) continue;
    const entry = records.get(uid);
    view.write("messages", uid, { ...entry.mutation.value, message }, entry);
  }
  const { receipts: _receipts, ...next } = session.turnSummaryCheckpoints[turnScopeId];
  view.write("checkpointHeads", turnScopeId, next, storedHeader);
  view.write("checkpoints", key, result.receipt, stored);
  await writeCheckpointMembership(view, { request, result, header });
  return { key, turnScopeId };
}

function collectReplayedMessageUids(request, replayedMessageUids) {
  const operations = [
    request.messages,
    request.messageContentAppends,
    request.messageContentReplacements ?? [],
    request.messageMetadataUpdates,
  ];
  for (const messages of operations)
    for (const { messageUid } of messages) replayedMessageUids.add(messageUid);
}

export async function preparePartitionCheckpointRequests({
  snapshot,
  view,
  scope,
  inputs,
  committedAt,
}) {
  const read = checkpointView(snapshot, view, [], scope);
  const replayedMessageUids = new Set();
  const seen = new Set();
  const entries = [];
  for (const input of inputs) {
    let request;
    try {
      request = parseTurnSummaryCheckpointRequest(input);
    } catch (cause) {
      rejectCheckpoint(cause);
    }
    if (request.sessionId !== scope.sessionId)
      throw new PartitionAdmissionRejection(
        "SESSION_SCOPE_IDENTITY_CONFLICT",
        "Checkpoint session ownership mismatch",
      );
    const key = JSON.stringify([request.turnScopeId, request.checkpointId]);
    if (seen.has(key))
      throw new PartitionAdmissionRejection(
        "SESSION_COMMIT_INPUT_INVALID",
        "Duplicate checkpoint in session delta",
      );
    seen.add(key);
    const stored = (
      await read.read({ collection: "checkpoints", keys: [key], includeOwner: true })
    ).get(key);
    const replay =
      stored && !stored.mutation.remove
        ? await applyCheckpoint(read, scope, { request, key, committedAt, stored })
        : null;
    if (replay) collectReplayedMessageUids(request, replayedMessageUids);
    entries.push({ key, request, replay, stored });
  }
  return { replayedMessageUids, entries };
}

export async function preparePartitionSummaryCheckpoints({
  snapshot,
  view,
  mutations,
  scope,
  entries,
  committedAt,
}) {
  if (!entries.length) return [];
  const staged = checkpointView(snapshot, view, mutations, scope);
  const results = [];
  for (const { key, request, replay, stored } of entries)
    results.push(
      replay ?? (await applyCheckpoint(staged, scope, { request, key, committedAt, stored })),
    );
  return results;
}

function checkpointWriteUids(request) {
  return new Set(
    [
      ...request.messages,
      ...(request.messageContentAppends ?? []),
      ...(request.messageContentReplacements ?? []),
      ...(request.messageMetadataUpdates ?? []),
    ].map(({ messageUid }) => messageUid),
  );
}

async function readCheckpointOriginReceipts({
  journal,
  transactions,
  checkpoint,
  uids,
  generation,
}) {
  const key = JSON.stringify([checkpoint.turnScopeId, checkpoint.receipt.checkpointId]);
  const origin = await journal.usingSnapshot((snapshot) =>
    transactions.readCheckpointOrigin(snapshot, key),
  );
  const record = origin?.transaction.mutations.find(
    (mutation) => mutation.collection === "checkpoints" && mutation.key === key,
  );
  if (
    !record ||
    origin.generation > generation ||
    !isDeepStrictEqual(record.value, checkpoint.receipt)
  )
    corrupt("Checkpoint receipt disagrees with its origin transaction");
  if (!origin.transaction.result?.summaryCheckpoints?.some((result) => result.key === key))
    throw partitionJournalError(
      "SESSION_OPERATION_RETRY_UNAVAILABLE",
      "Checkpoint was imported without a partition message commit",
    );
  return origin.transaction.mutations.flatMap(({ collection, key: uid, value, owner }, slot) =>
    collection === "messages" && uids.has(uid)
      ? [
          createMessagePersistenceReceipt(
            value.message,
            origin.generation,
            value.contentVersion,
            partitionMutationOwner(owner, { record: origin.reference, slot }),
          ),
        ]
      : [],
  );
}

export async function attachPartitionCheckpointMessageReceipts(
  journal,
  transactions,
  request,
  outcome,
) {
  const checkpoints = outcome.result?.summaryCheckpoints;
  if (!checkpoints?.length || request.epoch === null) return outcome;
  const requests = request.input.changes.summaryCheckpoints;
  const summaryCheckpoints = await Promise.all(
    checkpoints.map(async (checkpoint, index) => {
      const input = requests[index];
      if (
        input?.checkpointId !== checkpoint.receipt.checkpointId ||
        input.turnScopeId !== checkpoint.turnScopeId
      )
        corrupt("Checkpoint result does not match the submitted checkpoint");
      const uids = checkpointWriteUids(input);
      let messageReceipts = [];
      if (uids.size) {
        messageReceipts =
          checkpoint.deduplicated === true
            ? await readCheckpointOriginReceipts({
                journal,
                transactions,
                checkpoint,
                uids,
                generation: outcome.generation,
              })
            : outcome.result.messageReceipts.filter(({ messageUid }) => uids.has(messageUid));
        const returned = new Set(messageReceipts.map(({ messageUid }) => messageUid));
        if (
          messageReceipts.length !== uids.size ||
          returned.size !== uids.size ||
          messageReceipts.some(
            (receipt) =>
              receipt.sessionId !== input.sessionId ||
              receipt.turnScopeId !== input.turnScopeId ||
              receipt.dialogProcessId !== input.dialogProcessId,
          )
        )
          corrupt("Missing or invalid committed checkpoint message receipts");
      }
      return { ...checkpoint, messageReceipts };
    }),
  );
  return { ...outcome, result: { ...outcome.result, summaryCheckpoints } };
}
