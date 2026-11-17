/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_COMMAND,
  SESSION_ERROR_CODE,
  appendCommandReceipt,
  createAggregateVersionConflictError,
  decideAggregateConcurrency,
  decideCommandIdempotency,
  requireSessionAggregateVersion,
} from "@noobot/session-protocol";
import { prepareAttachmentBinding } from "../attachment-binding-request.js";
import { ImmutableSessionChanges, publishMessageIndexes } from "./immutable-message-changes.js";
import { requireImmutableAttachmentBindingResult } from "@noobot/session-protocol/immutable-storage-graph";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  immutableLifecycleCommandKey,
  immutableAttachmentBindingKey,
  writeImmutableCommand,
} from "./immutable-command-index.js";

export async function prepareImmutableAttachmentBinding({
  store,
  get,
  getMetadata,
  request,
  committedAt,
}) {
  const { identity, canonicalAttachments, normalizedExpectedVersion, requestHash } =
    prepareAttachmentBinding(request);
  if (identity.sessionId !== store.sessionId)
    throw new TypeError("Attachment binding session ownership mismatch");
  const plan = new ImmutableSessionChanges(get, {
    getMetadata,
    readContent: (reference) => store.objects.readValue(reference),
  });
  const metadata = await plan.get("metadata", "session");
  if (!metadata) throw immutableStorageError("Immutable session is not initialized");
  const receipt = await plan.get("commands", immutableLifecycleCommandKey(identity.commandId));
  const idempotency = decideCommandIdempotency({
    commandId: identity.commandId,
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    requestHash,
    receipts: receipt ? [receipt] : [],
  });
  if (!idempotency.allowed)
    throw Object.assign(new Error("commandId was reused with a different request"), {
      statusCode: 409,
      code: SESSION_ERROR_CODE.IDEMPOTENCY_KEY_REUSED,
    });
  const stored = await plan.getMetadata("messages", identity.messageUid);
  const record = stored?.value;
  if (
    !record ||
    record.message.turnScopeId !== identity.turnScopeId ||
    record.message.role !== "user"
  )
    throw Object.assign(new Error("Turn user message not found"), { statusCode: 404 });
  if (
    record.message.messageUid !== identity.messageUid ||
    record.message.sessionId !== store.sessionId
  )
    throw immutableStorageError("Attachment binding message index ownership mismatch");
  const currentVersion = requireSessionAggregateVersion(metadata.aggregateVersion);
  const result = (aggregateVersion, deduplicated) =>
    requireImmutableAttachmentBindingResult({
      messageUid: identity.messageUid,
      aggregateVersion,
      deduplicated,
    });
  if (idempotency.deduplicated)
    return { abort: true, changes: [], result: result(currentVersion, true) };
  if (await plan.get("commands", immutableAttachmentBindingKey(identity.messageUid)))
    throw Object.assign(new Error("Turn attachments are already bound"), {
      statusCode: 409,
      code: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
    });
  const concurrency = decideAggregateConcurrency({
    expectedAggregateVersion: normalizedExpectedVersion,
    aggregateVersion: currentVersion,
  });
  if (!concurrency.allowed) throw createAggregateVersionConflictError({ currentVersion });
  if (record.message.attachments.length > 0)
    throw Object.assign(new Error("Turn attachments are already bound"), {
      statusCode: 409,
      code: SESSION_ERROR_CODE.TURN_ATTACHMENTS_ALREADY_BOUND,
    });
  plan.set(
    "messages",
    identity.messageUid,
    {
      ...record,
      message: { ...record.message, attachments: canonicalAttachments },
    },
    stored.parts,
  );
  await publishMessageIndexes(store, plan);
  const [nextReceipt] = appendCommandReceipt([], {
    commandId: identity.commandId,
    type: SESSION_COMMAND.TURN_ATTACHMENTS_BIND,
    turnScopeId: identity.turnScopeId,
    requestHash,
    aggregateVersion: concurrency.nextAggregateVersion,
    result: { messageUid: identity.messageUid },
    committedAt,
  });
  await writeImmutableCommand(store, plan, nextReceipt);
  plan.set("metadata", "session", {
    ...(await plan.get("metadata", "session")),
    aggregateVersion: concurrency.nextAggregateVersion,
    updatedAt: committedAt,
  });
  return {
    changes: plan.changes(),
    result: result(concurrency.nextAggregateVersion, false),
  };
}
