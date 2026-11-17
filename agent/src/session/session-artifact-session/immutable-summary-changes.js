/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { parseTurnSummaryCheckpointRequest } from "@noobot/context-protocol/policy/summary-checkpoint-request";
import { applyTurnSummaryCheckpoint } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import { ImmutableSessionChanges, publishMessageIndexes } from "./immutable-message-changes.js";
import { assertImmutableToolPairClosure } from "./immutable-tool-pairs.js";
import { immutableStorageError } from "./immutable-object-store.js";

import { immutableCheckpointKey, writeImmutableCheckpoint } from "./immutable-checkpoint-index.js";

async function readCheckpointMessages(readManyMetadata, request, sessionId) {
  const records = new Map();
  const uids = [
    ...new Set([
      ...request.persistedMessageUids,
      ...request.summarizedMessageUids,
      ...request.retainedMessageUids,
    ]),
  ];
  const values = await readManyMetadata("messages", uids);
  for (const uid of uids) {
    const metadata = values.get(uid);
    if (!metadata) continue;
    const record = metadata.value;
    if (record.message.messageUid !== uid || record.message.sessionId !== sessionId)
      throw immutableStorageError("Checkpoint message index ownership mismatch");
    records.set(uid, metadata);
  }
  return records;
}

export async function prepareImmutableSummaryCheckpoint({
  store,
  get,
  getManyMetadata,
  checkpoint,
  committedAt,
}) {
  const request = parseTurnSummaryCheckpointRequest(checkpoint);
  if (request.sessionId !== store.sessionId)
    throw new TypeError("Summary checkpoint session ownership mismatch");
  const plan = new ImmutableSessionChanges(get);
  const read = (collection, key) => plan.get(collection, key);
  const key = immutableCheckpointKey(request.turnScopeId, request.checkpointId);
  const header = await read("checkpointHeads", request.turnScopeId);
  const receipt = await read("checkpoints", key);
  const lifecycle = await read("metadata", "lifecycle");
  if (!lifecycle) throw immutableStorageError("Immutable lifecycle is not initialized");
  const turn = await read("lifecycle", request.turnScopeId);
  const state = header ? { ...header, receipts: receipt ? [receipt] : [] } : undefined;
  if (receipt && !header) throw immutableStorageError("Checkpoint receipt has no owning state");
  const records = receipt
    ? new Map()
    : await readCheckpointMessages(getManyMetadata, request, store.sessionId);
  const session = {
    messages: [...records.values()].map(({ value }) => value.message),
    turnLifecycle: { ...lifecycle, turns: turn ? { [request.turnScopeId]: turn } : {} },
    ...(state ? { turnSummaryCheckpoints: { [request.turnScopeId]: state } } : {}),
  };

  const original = new Map(session.messages.map((message) => [message.messageUid, message]));
  const result = applyTurnSummaryCheckpoint(session, request, committedAt);
  if (!result.committed) return { changes: [], result };
  await assertImmutableToolPairClosure(read, [...original.values()], request.summarizedMessageUids);
  const changed = session.messages.filter(
    (message) => message !== original.get(message.messageUid),
  );
  for (const message of changed) {
    const { value, parts } = records.get(message.messageUid);
    plan.set("messages", message.messageUid, { ...value, message }, parts);
  }
  await publishMessageIndexes(store, plan);
  const { receipts, ...nextHeader } = session.turnSummaryCheckpoints[request.turnScopeId];
  plan.set("checkpointHeads", request.turnScopeId, nextHeader);
  await writeImmutableCheckpoint(store, plan, request.turnScopeId, result.receipt);
  const metadata = await read("metadata", "session");
  if (!metadata) throw immutableStorageError("Immutable session is not initialized");
  plan.set("metadata", "session", { ...metadata, updatedAt: committedAt });
  return { changes: plan.changes(), result };
}
