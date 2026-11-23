/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertTurnSummaryCheckpointState } from "@noobot/context-protocol/policy/summary";
import { summaryCheckpointEffectMessageUids as receiptUids } from "@noobot/context-protocol/policy/summary-checkpoint-transaction";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";

export function immutableCheckpointKey(turnScopeId, checkpointId) {
  return JSON.stringify([turnScopeId, checkpointId]);
}

async function requireImmutableCheckpointIndex(plan) {
  if ((await plan.get("metadata", "checkpointIndex"))?.version !== 1)
    throw Object.assign(new Error("Immutable checkpoint indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
}

async function descriptor(plan, collection, key) {
  const value = await plan.get(collection, key);
  if (value !== null && (!value.root || !Number.isSafeInteger(value.count) || value.count < 1))
    throw immutableStorageError("Invalid checkpoint membership descriptor");
  return value;
}

async function addMember({ store, plan, collection, key, member }) {
  const previous = await descriptor(plan, collection, key);
  if (await store.index.get(previous?.root ?? null, member))
    throw immutableStorageError("Duplicate checkpoint membership");
  const count = (previous?.count ?? 0) + 1;
  if (!Number.isSafeInteger(count)) throw immutableStorageError("Checkpoint membership overflow");
  const root = await store.index.set(
    previous?.root ?? null,
    member,
    await store.objects.putValue(member),
  );
  plan.set(collection, key, { count, root });
}

async function removeMember({ store, plan, collection, key, member }) {
  const previous = await descriptor(plan, collection, key);
  const reference = await store.index.get(previous?.root ?? null, member);
  if (!reference || (await store.objects.readValue(reference)) !== member)
    throw immutableStorageError("Missing checkpoint membership");
  const root = await store.index.set(previous.root, member, null);
  const count = previous.count - 1;
  if ((root === null) !== (count === 0))
    throw immutableStorageError("Checkpoint membership count mismatch");
  if (count === 0) plan.remove(collection, key);
  else plan.set(collection, key, { count, root });
}

async function assertReceipt(plan, turnScopeId, receipt) {
  const head = await plan.get("checkpointHeads", turnScopeId);
  if (!head) throw immutableStorageError("Checkpoint receipt has no owning state");
  assertTurnSummaryCheckpointState({ ...head, receipts: [receipt] }, turnScopeId);
}

export async function indexImmutableCheckpoint(store, plan, turnScopeId, receipt) {
  await assertReceipt(plan, turnScopeId, receipt);
  const key = immutableCheckpointKey(turnScopeId, receipt.checkpointId);
  await addMember({
    store,
    plan,
    collection: "turnCheckpoints",
    key: turnScopeId,
    member: receipt.checkpointId,
  });
  for (const uid of receiptUids(receipt))
    await addMember({ store, plan, collection: "messageCheckpoints", key: uid, member: key });
}

export async function writeImmutableCheckpoint(store, plan, turnScopeId, receipt) {
  await requireImmutableCheckpointIndex(plan);
  const key = immutableCheckpointKey(turnScopeId, receipt.checkpointId);
  if (await plan.get("checkpoints", key))
    throw immutableStorageError("Checkpoint receipt already exists");
  const orderKey = immutableCheckpointKey(
    turnScopeId,
    immutableOrderKey(receipt.checkpointRevision),
  );
  if (await plan.get("checkpointOrder", orderKey))
    throw immutableStorageError("Checkpoint revision already exists");
  await indexImmutableCheckpoint(store, plan, turnScopeId, receipt);
  plan.set("checkpoints", key, receipt);
  plan.set("checkpointOrder", orderKey, receipt.checkpointId);
}

async function removeReceipt(store, plan, turnScopeId, checkpointId) {
  const key = immutableCheckpointKey(turnScopeId, checkpointId);
  const receipt = await plan.get("checkpoints", key);
  if (!receipt || receipt.checkpointId !== checkpointId)
    throw immutableStorageError("Checkpoint membership references a missing receipt");
  await assertReceipt(plan, turnScopeId, receipt);
  const orderKey = immutableCheckpointKey(
    turnScopeId,
    immutableOrderKey(receipt.checkpointRevision),
  );
  if ((await plan.get("checkpointOrder", orderKey)) !== checkpointId)
    throw immutableStorageError("Checkpoint receipt order mismatch");
  for (const uid of receiptUids(receipt))
    await removeMember({ store, plan, collection: "messageCheckpoints", key: uid, member: key });
  await removeMember({
    store,
    plan,
    collection: "turnCheckpoints",
    key: turnScopeId,
    member: checkpointId,
  });
  plan.remove("checkpointOrder", orderKey);
  plan.remove("checkpoints", key);
}

async function members(store, plan, collection, key) {
  const value = await descriptor(plan, collection, key);
  const result = [];
  if (!value) return result;
  for await (const [member, reference] of store.index.entries(value.root)) {
    if ((await store.objects.readValue(reference)) !== member)
      throw immutableStorageError("Checkpoint membership identity mismatch");
    result.push(member);
  }
  if (result.length !== value.count)
    throw immutableStorageError("Checkpoint membership count mismatch");
  return result;
}

async function removeMessageCheckpoints(store, plan, uid) {
  const keys = await members(store, plan, "messageCheckpoints", uid);
  for (const key of keys) {
    const identity = JSON.parse(key);
    if (
      !Array.isArray(identity) ||
      identity.length !== 2 ||
      identity.some((part) => typeof part !== "string" || !part || part.trim() !== part) ||
      immutableCheckpointKey(...identity) !== key
    )
      throw immutableStorageError("Invalid checkpoint reference identity");
    const receipt = await plan.get("checkpoints", key);
    if (!receipt || !receiptUids(receipt).has(uid))
      throw immutableStorageError("Checkpoint reference does not belong to its message");
    await removeReceipt(store, plan, ...identity);
  }
  return keys.length;
}

export async function removeImmutableMessageCheckpoints(store, plan, messageUids) {
  await requireImmutableCheckpointIndex(plan);
  let removed = 0;
  for (const uid of new Set(messageUids))
    removed += await removeMessageCheckpoints(store, plan, uid);
  return { removed };
}

export async function removeImmutableTurnCheckpoints(store, plan, turnScopeIds) {
  await requireImmutableCheckpointIndex(plan);
  let removed = 0;
  for (const scope of new Set(turnScopeIds)) {
    for (const id of await members(store, plan, "turnCheckpoints", scope)) {
      await removeReceipt(store, plan, scope, id);
      removed += 1;
    }
    plan.remove("checkpointHeads", scope);
  }
  return { removed };
}
