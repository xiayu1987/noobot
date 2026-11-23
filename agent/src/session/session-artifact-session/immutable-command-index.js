/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  decideCommandIdempotency,
  isCanonicalCommandReceipt,
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { immutableStorageError } from "./immutable-object-store.js";
import { isCanonicalText } from "@noobot/shared/value";
import {
  IMMUTABLE_COMMIT_INDEX_VERSION,
  requireImmutableCommitOrigin,
} from "@noobot/session-protocol/immutable-storage-graph";

const COMMAND_CHANGE_COLLECTIONS = Object.freeze([
  "commands",
  "messages",
  "messageOrder",
  "turns",
  "lifecycle",
  "replacements",
  "timings",
  "metadata",
]);

export function immutableLifecycleCommandKey(commandId) {
  return JSON.stringify(["lifecycle", commandId]);
}

export async function readImmutableCommandChanges({ store, snapshot, commandId }) {
  if (!isCanonicalText(commandId))
    throw new TypeError("Command changes require a canonical command ID");
  const header = await store.get(snapshot, "metadata", "commitIndex");
  if (header?.version !== IMMUTABLE_COMMIT_INDEX_VERSION)
    throw Object.assign(new Error("Immutable commit indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  const key = immutableLifecycleCommandKey(commandId);
  const receipt = await store.get(snapshot, "commands", key);
  const origin = await store.get(snapshot, "commandCommits", key);
  if (receipt === null && origin === null) return null;
  assertReceipt(receipt);
  requireImmutableCommitOrigin(origin, snapshot.generation);
  if (receipt.commandId !== commandId)
    throw immutableStorageError("Invalid indexed command commit origin");
  const committed = await store.readCommitChanges(snapshot, {
    generation: origin.generation,
    collections: origin.kind === "baseline" ? ["commands"] : COMMAND_CHANGE_COLLECTIONS,
  });
  const command = committed.changes.find(
    (change) => change.collection === "commands" && change.key === key,
  );
  if (!command || command.remove || JSON.stringify(command.value) !== JSON.stringify(receipt))
    throw immutableStorageError("Command receipt disagrees with its indexed commit");
  if (origin.kind === "baseline")
    return { kind: "baseline", generation: origin.generation, receipt, changes: null };
  return {
    kind: "commit",
    generation: origin.generation,
    receipt,
    changes: committed.changes.filter((change) => change.collection !== "commands"),
  };
}

export async function decideImmutableCommandReplay(plan, { commandId, type, requestHash }) {
  const previous = await plan.get("commands", immutableLifecycleCommandKey(commandId));
  const decision = decideCommandIdempotency({
    commandId,
    type,
    requestHash,
    receipts: previous ? [previous] : [],
  });
  if (!decision.allowed)
    throw Object.assign(new Error("commandId was reused with a different request"), {
      code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
      statusCode: 409,
    });
  return decision;
}

export function immutableAttachmentBindingKey(messageUid) {
  return JSON.stringify(["attachmentBinding", messageUid]);
}

async function requireImmutableCommandIndex(plan) {
  const header = await plan.get("metadata", "commandIndex");
  if (header?.version !== 1)
    throw Object.assign(new Error("Immutable command indexes require an offline upgrade"), {
      code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED",
    });
  return header;
}

function assertReceipt(receipt) {
  if (!isCanonicalCommandReceipt(receipt))
    throw immutableStorageError("Invalid indexed command receipt");
  if (
    receipt.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND &&
    (!receipt.turnScopeId ||
      typeof receipt.result?.messageUid !== "string" ||
      !receipt.result.messageUid ||
      receipt.result.messageUid.trim() !== receipt.result.messageUid)
  )
    throw immutableStorageError("Invalid attachment binding command identity");
}

async function readScope(plan, turnScopeId) {
  const descriptor = await plan.get("turnCommands", turnScopeId);
  if (
    descriptor !== null &&
    (descriptor.turnScopeId !== turnScopeId ||
      !descriptor.root ||
      !Number.isSafeInteger(descriptor.count) ||
      descriptor.count < 1)
  )
    throw immutableStorageError("Invalid command turn descriptor");
  return descriptor;
}

export async function indexImmutableCommand(store, plan, receipt) {
  assertReceipt(receipt);
  if (!receipt.turnScopeId) return;
  const previous = await readScope(plan, receipt.turnScopeId);
  if (await store.index.get(previous?.root ?? null, receipt.commandId))
    throw immutableStorageError("Duplicate command turn membership");
  const count = (previous?.count ?? 0) + 1;
  if (!Number.isSafeInteger(count)) throw immutableStorageError("Command turn count overflow");
  const root = await store.index.set(
    previous?.root ?? null,
    receipt.commandId,
    await store.objects.putValue(receipt.commandId),
  );
  plan.set("turnCommands", receipt.turnScopeId, { turnScopeId: receipt.turnScopeId, count, root });
}

export async function writeImmutableCommand(store, plan, receipt) {
  await requireImmutableCommandIndex(plan);
  assertReceipt(receipt);
  const key = immutableLifecycleCommandKey(receipt.commandId);
  if (await plan.get("commands", key))
    throw immutableStorageError("Command receipt already exists");
  await indexImmutableCommand(store, plan, receipt);
  plan.set("commands", key, receipt);
  if (receipt.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND) {
    const bindingKey = immutableAttachmentBindingKey(receipt.result.messageUid);
    if (await plan.get("commands", bindingKey))
      throw immutableStorageError("Attachment binding command already exists");
    plan.set("commands", bindingKey, receipt.commandId);
  }
}

async function retireSuffixCommand({
  store,
  plan,
  turnScopeId,
  commandId,
  reference,
  removedUids,
}) {
  if ((await store.objects.readValue(reference)) !== commandId)
    throw immutableStorageError("Command turn membership identity mismatch");
  const key = immutableLifecycleCommandKey(commandId);
  const receipt = await plan.get("commands", key);
  assertReceipt(receipt);
  if (receipt.commandId !== commandId || receipt.turnScopeId !== turnScopeId)
    throw immutableStorageError("Command turn receipt ownership mismatch");
  if (receipt.type === SESSION_COMMAND.TURN_ATTACHMENTS_BIND) {
    const bindingKey = immutableAttachmentBindingKey(receipt.result.messageUid);
    if ((await plan.get("commands", bindingKey)) !== commandId)
      throw immutableStorageError("Attachment binding command index mismatch");
    if (!removedUids.has(receipt.result.messageUid)) return false;
    plan.remove("commands", bindingKey);
  }
  plan.remove("commands", key);
  return true;
}

async function retireTurnCommands(store, plan, turnScopeId, removedUids) {
  const descriptor = await readScope(plan, turnScopeId);
  if (descriptor === null) return 0;
  let count = 0;
  let removed = 0;
  let root = descriptor.root;
  for await (const [commandId, reference] of store.index.entries(descriptor.root)) {
    if (
      await retireSuffixCommand({ store, plan, turnScopeId, commandId, reference, removedUids })
    ) {
      root = await store.index.set(root, commandId, null);
      removed += 1;
    }
    count += 1;
  }
  if (count !== descriptor.count) throw immutableStorageError("Command turn count mismatch");
  if (root === null) plan.remove("turnCommands", turnScopeId);
  else if (removed)
    plan.set("turnCommands", turnScopeId, { turnScopeId, count: count - removed, root });
}

export async function retireImmutableSuffixCommands(store, plan, { turnScopeIds, uids }) {
  await requireImmutableCommandIndex(plan);
  const removedUids = new Set(uids);
  for (const turnScopeId of turnScopeIds)
    await retireTurnCommands(store, plan, turnScopeId, removedUids);
}
