/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createAggregateVersionConflictError,
  createMessageDeleteFingerprint,
  createMessageDeleteResult,
  decideAggregateConcurrency,
  parseMessageDeleteRequest,
  resolveSessionMessageSuffix,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { commitIndexedTurnDeletion } from "@noobot/authoritative-state/application";
import { artifactRetirementKey } from "@noobot/event-protocol/plugin-artifact-event";
import { readOutboxTail } from "./immutable-outbox.js";
import { immutableOrderKey } from "./immutable-order-key.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  removeImmutableContextCandidates,
  updateImmutableContextSource,
} from "./immutable-context-source-index.js";
import { requireImmutableContextIndex } from "@noobot/session-protocol/immutable-storage-graph";
import { updateImmutableTitleCandidate } from "./immutable-title-index.js";
import { updateImmutableToolPairs } from "./immutable-tool-pairs.js";
import {
  retireImmutableSuffixCommands,
  decideImmutableCommandReplay,
  writeImmutableCommand,
} from "./immutable-command-index.js";
import {
  removeImmutableMessageCheckpoints,
  removeImmutableTurnCheckpoints,
} from "./immutable-checkpoint-index.js";
import { prepareImmutableOutboxTurnRemoval } from "./immutable-outbox-turn-index.js";
import {
  requireImmutableMessageTailIndex,
  removeImmutableMessageTail,
} from "./immutable-message-tail-index.js";

async function readPosition(plan, ordinal) {
  const uid = await plan.get("messageOrder", immutableOrderKey(ordinal));
  const stored = uid && (await plan.getMetadata("messages", uid));
  const record = stored?.value;
  if (!record || record.ordinal !== ordinal || record.message?.messageUid !== uid)
    throw immutableStorageError("Message deletion encountered an invalid committed position");
  return stored;
}

export async function readFirstImmutableTurnMessage(store, plan, turnScopeId) {
  const turn = await plan.get("turns", turnScopeId);
  if (turn === null)
    throw Object.assign(new Error("message anchor not found"), { statusCode: 404 });
  const reference = await store.index.get(turn.messageOrderRoot, immutableOrderKey(1));
  const uid = reference && (await store.objects.readValue(reference));
  const record = uid && (await plan.getMetadata("messages", uid))?.value;
  if (
    !record ||
    record.turnOrdinal !== 1 ||
    record.message?.turnScopeId !== turnScopeId ||
    record.message.messageUid !== uid ||
    record.message.dialogProcessId !== turn.dialogProcessId
  )
    throw immutableStorageError("Message deletion anchor ownership mismatch");
  return record;
}

async function removeRecord(store, plan, stored) {
  const record = stored.value;
  const { message, turnOrdinal } = record;
  const turn = await plan.get("turns", message.turnScopeId);
  if (
    !turn ||
    turn.dialogProcessId !== message.dialogProcessId ||
    turn.messageSequence !== turnOrdinal
  )
    throw immutableStorageError("Message deletion must remove each turn suffix in reverse order");
  const reference = await store.index.get(turn.messagesRoot, message.messageUid);
  if (
    !reference ||
    JSON.stringify(await store.objects.readValueMetadata(reference)) !== JSON.stringify(stored)
  )
    throw immutableStorageError("Message deletion turn and UID indexes disagree");
  const orderReference = await store.index.get(
    turn.messageOrderRoot,
    immutableOrderKey(turnOrdinal),
  );
  if (!orderReference || (await store.objects.readValue(orderReference)) !== message.messageUid)
    throw immutableStorageError("Message deletion turn position mismatch");
  await updateImmutableToolPairs(store, plan, message, null);
  await updateImmutableTitleCandidate(store, plan, record, null);
  await updateImmutableContextSource(store, plan, message.turnScopeId, [
    [immutableOrderKey(turnOrdinal), null],
  ]);
  const next = {
    ...turn,
    messageCount: turn.messageCount - 1,
    messageSequence: turnOrdinal - 1,
    messagesRoot: await store.index.set(turn.messagesRoot, message.messageUid, null),
    messageOrderRoot: await store.index.set(
      turn.messageOrderRoot,
      immutableOrderKey(turnOrdinal),
      null,
    ),
    canonicalAssistantUid:
      turn.canonicalAssistantUid === message.messageUid ? "" : turn.canonicalAssistantUid,
  };
  if (next.messageCount < 0 || next.messageCount !== next.messageSequence)
    throw immutableStorageError("Message deletion turn count mismatch");
  if (next.messageCount) plan.set("turns", message.turnScopeId, next);
  else {
    if (next.messagesRoot !== null || next.messageOrderRoot !== null)
      throw immutableStorageError("Empty turn retains message indexes");
    plan.remove("turns", message.turnScopeId);
    await removeImmutableContextCandidates(plan, message.turnScopeId);
    plan.remove("turnOrder", immutableOrderKey(turn.turnOrdinal));
    await removeDialogTurn(store, plan, turn);
  }
  plan.remove("messages", message.messageUid);
  plan.remove("messageOrder", immutableOrderKey(record.ordinal));
}

async function removeDialogTurn(store, plan, turn) {
  const descriptor = await plan.get("dialogTurns", turn.dialogProcessId);
  if (!descriptor || !Number.isSafeInteger(descriptor.count) || descriptor.count < 1)
    throw immutableStorageError("Deleted turn has no dialog membership");
  const key = immutableOrderKey(descriptor.count);
  const reference = await store.index.get(descriptor.root, key);
  if (!reference || (await store.objects.readValue(reference)) !== turn.turnScopeId)
    throw immutableStorageError("Deleted turn is not the dialog suffix");
  const root = await store.index.set(descriptor.root, key, null);
  if (descriptor.count > 1) {
    plan.set("dialogTurns", turn.dialogProcessId, { count: descriptor.count - 1, root });
    return;
  }
  if (root !== null) throw immutableStorageError("Empty dialog retains turn memberships");
  const dialog = await plan.get("dialogs", turn.dialogProcessId);
  if (!dialog) throw immutableStorageError("Deleted dialog metadata is missing");
  plan.remove("dialogTurns", turn.dialogProcessId);
  const context = await plan.get("contextTurns", turn.dialogProcessId);
  if (context?.count !== 0 || context.root !== null)
    throw immutableStorageError("Deleted dialog retains context turn memberships");
  plan.remove("contextTurns", turn.dialogProcessId);
  plan.remove("dialogs", turn.dialogProcessId);
  plan.remove("dialogOrder", immutableOrderKey(dialog.dialogOrdinal));
}

export async function removeImmutableMessageSuffix({ store, plan, facts, anchor }) {
  requireImmutableContextIndex(facts);
  const suffix = resolveSessionMessageSuffix(anchor.ordinal, facts.messageSequence);
  if (suffix === null)
    throw immutableStorageError("Message deletion anchor position is outside the session");
  const { retainedMessageCount: anchorIndex, messageSuffix } = suffix;
  await requireImmutableMessageTailIndex(plan);
  const nextFacts = { ...facts, messageCount: anchorIndex, messageSequence: anchorIndex };
  const scopes = new Set();
  const uids = [];
  for (let ordinal = facts.messageSequence; ordinal > anchorIndex; ordinal -= 1) {
    const stored = await readPosition(plan, ordinal);
    const record = stored.value;
    if (ordinal === anchor.ordinal && record.message.messageUid !== anchor.message.messageUid)
      throw immutableStorageError("Message deletion anchor disagrees with global order");
    scopes.delete(record.message.turnScopeId);
    scopes.add(record.message.turnScopeId);
    uids.push(record.message.messageUid);
    await removeImmutableMessageTail(plan, nextFacts, record);
    await removeRecord(store, plan, stored);
  }
  return { messageSuffix, nextFacts, turnScopeIds: [...scopes].reverse(), uids };
}

export async function removeImmutableSuffixFacts(store, plan, { turnScopeIds, uids }) {
  const through = await readOutboxTail((...args) => plan.get(...args));
  const removedTurnScopeIds = [];
  for (const scope of turnScopeIds) {
    plan.set("metadata", artifactRetirementKey(scope), through);
    plan.remove("lifecycle", scope);
    if ((await plan.get("turns", scope)) === null) {
      removedTurnScopeIds.push(scope);
      plan.remove("timings", scope);
    }
  }
  await removeImmutableMessageCheckpoints(store, plan, uids);
  await removeImmutableTurnCheckpoints(store, plan, removedTurnScopeIds);
  await retireImmutableSuffixCommands(store, plan, { turnScopeIds, uids });
  await prepareImmutableOutboxTurnRemoval(store, plan, { turnScopeIds });
}

export async function readImmutableSuffixMutationState(plan, expectedAggregateVersion) {
  const metadata = await plan.get("metadata", "session");
  const facts = await plan.get("metadata", "facts");
  const header = await plan.get("metadata", "lifecycle");
  if (
    !metadata ||
    !facts ||
    !header ||
    !Number.isSafeInteger(facts.messageSequence) ||
    facts.messageSequence !== facts.messageCount
  )
    throw immutableStorageError("Suffix mutation requires initialized session facts");
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion,
    aggregateVersion: metadata.aggregateVersion,
  });
  if (!concurrency.allowed)
    throw createAggregateVersionConflictError({ currentVersion: metadata.aggregateVersion });
  return { metadata, facts, header, concurrency };
}

export async function prepareImmutableMessageDeletion({ store, plan, request, committedAt }) {
  const command = parseMessageDeleteRequest(request);
  const requestHash = createMessageDeleteFingerprint(command);
  const type = SESSION_COMMAND.MESSAGE_DELETE_FROM;
  const decision = await decideImmutableCommandReplay(plan, {
    commandId: command.commandId,
    type,
    requestHash,
  });
  if (decision.deduplicated) return { receipt: decision.receipt, deduplicated: true };
  const { metadata, facts, header, concurrency } = await readImmutableSuffixMutationState(
    plan,
    command.expectedAggregateVersion,
  );
  const anchor = await readFirstImmutableTurnMessage(store, plan, command.anchor.turnScopeId);
  const { messageSuffix, nextFacts, turnScopeIds, uids } = await removeImmutableMessageSuffix({
    store,
    plan,
    facts,
    anchor,
  });
  const lifecycle = await commitIndexedTurnDeletion({
    header,
    turnScopeIds,
    readTurn: (key) => plan.get("lifecycle", key),
  });
  if (!lifecycle.applied) throw new TypeError(`Message deletion rejected: ${lifecycle.reason}`);
  for (const turn of lifecycle.changedTurns) plan.set("lifecycle", turn.turnScopeId, turn);
  plan.set("metadata", "lifecycle", lifecycle.header);
  await removeImmutableSuffixFacts(store, plan, { turnScopeIds, uids });
  plan.set("metadata", "facts", nextFacts);
  plan.set("metadata", "session", {
    ...metadata,
    aggregateVersion: concurrency.nextAggregateVersion,
    updatedAt: committedAt,
  });
  const receipt = {
    type,
    commandId: command.commandId,
    requestHash,
    aggregateVersion: concurrency.nextAggregateVersion,
    committedAt,
    result: createMessageDeleteResult(messageSuffix, turnScopeIds),
  };
  await writeImmutableCommand(store, plan, receipt);
  return { receipt, deduplicated: false };
}
