/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  attachmentBindingResult,
  checkAttachmentBindingCommand,
  createAttachmentBindingReceipt,
  requireAttachmentBindingTarget,
} from "@noobot/session-protocol";
import { prepareAttachmentBinding } from "../attachment-binding-request.js";
import { publishMessageIndexes } from "./immutable-message-changes.js";
import { immutableStorageError } from "./immutable-object-store.js";
import {
  immutableLifecycleCommandKey,
  immutableAttachmentBindingKey,
  writeImmutableCommand,
} from "./immutable-command-index.js";

export async function prepareImmutableAttachmentBinding({ store, plan, request, committedAt }) {
  const binding = prepareAttachmentBinding(request);
  const { identity, canonicalAttachments } = binding;
  if (identity.sessionId !== store.sessionId)
    throw new TypeError("Attachment binding session ownership mismatch");
  const metadata = await plan.get("metadata", "session");
  if (!metadata) throw immutableStorageError("Immutable session is not initialized");
  const receipt = await plan.get("commands", immutableLifecycleCommandKey(identity.commandId));
  const deduplicated = checkAttachmentBindingCommand(binding, receipt);
  const stored = await plan.getMetadata("messages", identity.messageUid);
  const record = stored?.value;
  requireAttachmentBindingTarget(record?.message, identity.turnScopeId);
  if (
    record.message.messageUid !== identity.messageUid ||
    record.message.sessionId !== store.sessionId
  )
    throw immutableStorageError("Attachment binding message index ownership mismatch");
  if (deduplicated)
    return attachmentBindingResult(identity.messageUid, metadata.aggregateVersion, true);
  const nextReceipt = createAttachmentBindingReceipt(binding, {
    aggregateVersion: metadata.aggregateVersion,
    alreadyBound: Boolean(
      await plan.get("commands", immutableAttachmentBindingKey(identity.messageUid)),
    ),
    hasAttachments: record.message.attachments.length > 0,
    committedAt,
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
  await writeImmutableCommand(store, plan, nextReceipt);
  plan.set("metadata", "session", {
    ...(await plan.get("metadata", "session")),
    aggregateVersion: nextReceipt.aggregateVersion,
    updatedAt: committedAt,
  });
  return attachmentBindingResult(identity.messageUid, nextReceipt.aggregateVersion, false);
}
