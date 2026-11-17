/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnReplaceFingerprint,
  createTurnReplacementCommit,
  isDialogAnchorMessageRecord,
  parseTurnReplacementChange,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { commitIndexedTurnReplacement } from "@noobot/authoritative-state/application";
import { normalizeMessageEntity } from "../entities/message-entity.js";
import { dedupeAttachmentsByIdentity } from "@noobot/attachment-protocol";
import { prepareImmutableMessages } from "./immutable-message-changes.js";
import {
  readFirstImmutableTurnMessage,
  readImmutableSuffixMutationState,
  removeImmutableMessageSuffix,
  removeImmutableSuffixFacts,
} from "./immutable-message-deletion.js";
import {
  decideImmutableCommandReplay,
  immutableLifecycleCommandKey,
  writeImmutableCommand,
} from "./immutable-command-index.js";
import { immutableStorageError } from "./immutable-object-store.js";
import { readImmutableIndexedTitle } from "./immutable-title-index.js";
import {
  requireImmutableMessageTailIndex,
  readImmutableMessagePredecessor,
} from "./immutable-message-tail-index.js";

async function replacementAnchor(store, plan, turnScopeId) {
  await requireImmutableMessageTailIndex(plan);
  const first = await readFirstImmutableTurnMessage(store, plan, turnScopeId);
  const { userMessageUid } = await readImmutableMessagePredecessor(plan, first.message.messageUid);
  const anchor = userMessageUid && (await plan.get("messages", userMessageUid));
  if (
    !anchor ||
    anchor.message?.messageUid !== userMessageUid ||
    anchor.message.dialogProcessId !== first.message.dialogProcessId ||
    !isDialogAnchorMessageRecord(anchor.message) ||
    anchor.ordinal > first.ordinal
  )
    throw immutableStorageError("Turn replacement requires a valid indexed user anchor");
  return anchor;
}

function replacementMessage(anchor, command, identity, committedAt) {
  const message = { ...anchor.message };
  for (const key of [
    "turnId",
    "messageUid",
    "userMessageId",
    "channelState",
    "error",
    "status",
    "terminalOutcome",
    "state",
    "__noobotRuntimeRunStateKey",
  ])
    delete message[key];
  return normalizeMessageEntity({
    ...message,
    ...identity,
    role: "user",
    type: "message",
    content: command.newContent,
    turnScopeId: command.turnScopeId,
    pending: false,
    done: true,
    ts: committedAt,
    attachments: dedupeAttachmentsByIdentity(command.attachments),
  });
}

export async function prepareImmutableTurnReplacement({ store, plan, request, committedAt }) {
  request = parseTurnReplacementChange(request);
  const { command } = request;
  const requestHash = createTurnReplaceFingerprint(command);
  const type = SESSION_COMMAND.TURN_REPLACE;
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
  if (
    (await plan.get("turns", command.turnScopeId)) !== null ||
    (await plan.get("lifecycle", command.turnScopeId)) !== null ||
    (await plan.get("replacements", command.turnScopeId)) !== null ||
    (await plan.get("dialogs", request.identity.dialogProcessId)) !== null ||
    (await plan.get("messages", request.identity.messageUid)) !== null
  )
    throw new TypeError("Turn replacement must allocate fresh message, dialog and turn identities");
  const anchor = await replacementAnchor(store, plan, command.anchor.turnScopeId);
  const message = replacementMessage(anchor, command, request.identity, committedAt);
  const suffix = await removeImmutableMessageSuffix({ store, plan, facts, anchor });
  const replacement = createTurnReplacementCommit({
    commandId: command.commandId,
    sessionId: store.sessionId,
    committedAggregateVersion: concurrency.nextAggregateVersion,
    replacedTurnScopeIds: suffix.turnScopeIds,
    replacementDialogProcessId: message.dialogProcessId,
    replacementTurnScopeId: message.turnScopeId,
    replacementUserMessageUid: message.messageUid,
    requestHash,
    committedAt,
  });
  const lifecycle = await commitIndexedTurnReplacement({
    header,
    replacement,
    readTurn: (key) => plan.get("lifecycle", key),
    readReplacement: (key) => plan.get("replacements", key),
    readCommandReplacement: async (key) =>
      (await plan.get("commands", immutableLifecycleCommandKey(key)))?.result.turnReplacement ??
      null,
  });
  if (!lifecycle.applied) throw new TypeError(`Turn replacement rejected: ${lifecycle.reason}`);
  for (const turn of lifecycle.changedTurns) plan.set("lifecycle", turn.turnScopeId, turn);
  for (const tombstone of lifecycle.changedReplacements)
    plan.set("replacements", tombstone.turnScopeId, tombstone);
  await removeImmutableSuffixFacts(store, plan, suffix);
  plan.set("metadata", "facts", suffix.nextFacts);
  plan.set("metadata", "lifecycle", lifecycle.header);
  const nextMetadata = {
    ...metadata,
    aggregateVersion: concurrency.nextAggregateVersion,
    updatedAt: committedAt,
  };
  const autoTitle = await readImmutableIndexedTitle(store, plan);
  if (autoTitle) nextMetadata.autoTitle = autoTitle;
  else delete nextMetadata.autoTitle;
  plan.set("metadata", "session", nextMetadata);
  const prepared = await prepareImmutableMessages({
    store,
    get: (collection, key) => plan.get(collection, key),
    getMetadata: (collection, key) => plan.getMetadata(collection, key),
    messages: [message],
    updatedAt: committedAt,
  });
  for (const change of prepared.changes) await plan.apply(change);
  const receipt = {
    type,
    commandId: command.commandId,
    requestHash,
    aggregateVersion: concurrency.nextAggregateVersion,
    committedAt,
    result: { turnReplacement: replacement },
  };
  await writeImmutableCommand(store, plan, receipt);
  return { receipt, deduplicated: false };
}
