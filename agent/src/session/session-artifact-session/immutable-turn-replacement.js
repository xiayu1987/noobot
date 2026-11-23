/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createTurnReplaceFingerprint,
  createTurnReplacementCommit,
  matchesTurnReplacementAnchor,
  parseTurnReplacementChange,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { commitIndexedTurnReplacement } from "@noobot/authoritative-state/application";
import { createTurnReplacementMessage } from "../entities/turn-replacement-message.js";
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
import {
  requireImmutableMessageTailIndex,
  readImmutableMessagePredecessor,
} from "./immutable-message-tail-index.js";

async function replacementAnchor(store, plan, turnScopeId) {
  await requireImmutableMessageTailIndex(plan);
  const first = await readFirstImmutableTurnMessage(store, plan, turnScopeId);
  const { userMessageUid } = await readImmutableMessagePredecessor(plan, first.message.messageUid);
  const anchor = userMessageUid && (await plan.getMetadata("messages", userMessageUid))?.value;
  if (
    !matchesTurnReplacementAnchor({ first, indexedMessageUid: userMessageUid, candidate: anchor })
  )
    throw immutableStorageError("Turn replacement requires a valid indexed user anchor");
  return anchor;
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
  const message = createTurnReplacementMessage(
    anchor.message,
    command,
    request.identity,
    committedAt,
  );
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
  plan.set("metadata", "session", {
    ...metadata,
    aggregateVersion: concurrency.nextAggregateVersion,
    updatedAt: committedAt,
  });
  await prepareImmutableMessages({
    store,
    plan,
    messages: [message],
    updatedAt: committedAt,
  });
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
