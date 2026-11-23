/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  applySessionMetadataCommit,
  applySessionSettings,
  attachmentBindingResult,
  checkAttachmentBindingCommand,
  createAttachmentBindingReceipt,
  requireAttachmentBindingTarget,
  requireNextTurnAcceptanceVersion,
} from "@noobot/session-protocol";
import {
  mergeUserMetaParsedResults,
  SessionCommitInputError,
} from "@noobot/session-protocol/session-changes";
import {
  PartitionAdmissionRejection,
  partitionJournalError,
} from "@noobot/session-protocol/partition-journal";
import { PARTITION_MESSAGE_COLLECTIONS as collections } from "@noobot/session-protocol/partition-session-messages";
import { PARTITION_SESSION_METADATA } from "@noobot/session-protocol/partition-transaction";
import { prepareAttachmentBinding } from "../attachment-binding-request.js";

function set(collection, key, value, owner = null) {
  return { collection, key, owner, value };
}

async function lookup(view, collection, key) {
  const entry = (await view.getLatestMany({ collection, keys: [key] })).get(key);
  return entry?.mutation.remove ? null : entry;
}

async function requireMetadata(view) {
  const { collection, key } = PARTITION_SESSION_METADATA;
  const metadata = await lookup(view, collection, key);
  if (!metadata)
    throw partitionJournalError("SESSION_STORAGE_CORRUPT", "Missing partition session metadata");
  return metadata;
}

export async function preparePartitionSessionMetadata(
  view,
  mutations,
  { sessionMetadata, advanceVersion, touch, committedAt },
) {
  if (!sessionMetadata && !advanceVersion && !touch) return;
  const current = await requireMetadata(view);
  if (!sessionMetadata && !advanceVersion && current.mutation.value.updatedAt === committedAt)
    return;
  let next;
  try {
    next = sessionMetadata
      ? applySessionSettings(current.mutation.value, sessionMetadata, committedAt)
      : applySessionMetadataCommit(current.mutation.value, { committedAt });
    if (advanceVersion)
      next = applySessionMetadataCommit(next, {
        committedAt,
        aggregateVersion: requireNextTurnAcceptanceVersion(next.aggregateVersion),
      });
  } catch (cause) {
    if (!(cause instanceof SessionCommitInputError)) throw cause;
    throw Object.assign(new PartitionAdmissionRejection(cause.code, cause.message), { cause });
  }
  const { collection, key } = PARTITION_SESSION_METADATA;
  mutations.push(set(collection, key, next, current.owner));
}

export async function prepareUserMetaResult(view, requirePreviousMessage, request, committedAt) {
  const { messageUid, result } = request;
  const source = await lookup(view, collections.messages, messageUid);
  const record = source && (await requirePreviousMessage(source.mutation.value, { messageUid }));
  if (!record)
    throw new PartitionAdmissionRejection(
      "USER_META_SOURCE_NOT_FOUND",
      `user_meta source message not found: ${messageUid}`,
    );
  if (record.message.role !== "user")
    throw new PartitionAdmissionRejection(
      "USER_META_SOURCE_ROLE_CONFLICT",
      `user_meta source must be a user message: ${messageUid}`,
    );
  const userMetaParsedResults = mergeUserMetaParsedResults(
    record.message.userMetaParsedResults,
    result,
  );
  const { collection, key } = PARTITION_SESSION_METADATA;
  const metadata = await requireMetadata(view);
  return {
    action: "commit",
    mutations: [
      set(
        collections.messages,
        messageUid,
        {
          ...record,
          message: { ...record.message, userMetaParsedResults },
        },
        source.owner,
      ),
      set(
        collection,
        key,
        applySessionMetadataCommit(metadata.mutation.value, { committedAt }),
        metadata.owner,
      ),
    ],
    result: { userMetaSourceMessageUid: messageUid },
  };
}

export async function preparePartitionAttachmentBinding({
  view,
  scope,
  requirePreviousMessage,
  request,
  committedAt,
}) {
  try {
    const binding = prepareAttachmentBinding(request);
    const { identity, canonicalAttachments } = binding;
    const { messageUid, commandId, turnScopeId } = identity;
    if (identity.sessionId !== scope.sessionId)
      throw new PartitionAdmissionRejection(
        "SESSION_SCOPE_IDENTITY_CONFLICT",
        "Attachment binding session ownership mismatch",
      );
    const command = await lookup(view, "commands", commandId);
    const deduplicated = checkAttachmentBindingCommand(binding, command?.mutation.value);
    const source = await lookup(view, collections.messages, messageUid);
    const record = source && (await requirePreviousMessage(source.mutation.value, { messageUid }));
    requireAttachmentBindingTarget(record?.message, turnScopeId);
    const { collection, key } = PARTITION_SESSION_METADATA;
    const metadata = await requireMetadata(view);
    const aggregateVersion = metadata.mutation.value.aggregateVersion;
    if (deduplicated)
      return {
        action: "abort",
        result: { attachmentBinding: attachmentBindingResult(messageUid, aggregateVersion, true) },
      };
    const receipt = createAttachmentBindingReceipt(binding, {
      aggregateVersion,
      alreadyBound: Object.hasOwn(record, "attachmentBindingCommandId"),
      hasAttachments: record.message.attachments.length > 0,
      committedAt,
    });
    return {
      action: "commit",
      mutations: [
        set(
          collections.messages,
          messageUid,
          {
            ...record,
            attachmentBindingCommandId: commandId,
            message: { ...record.message, attachments: canonicalAttachments },
          },
          source.owner,
        ),
        set("commands", commandId, receipt),
        set(
          collection,
          key,
          applySessionMetadataCommit(metadata.mutation.value, {
            aggregateVersion: receipt.aggregateVersion,
            committedAt,
          }),
          metadata.owner,
        ),
      ],
      result: { attachmentBindingCommandId: commandId },
    };
  } catch (cause) {
    if (![400, 404, 409].includes(cause?.statusCode)) throw cause;
    throw Object.assign(
      new PartitionAdmissionRejection(cause.code ?? "SESSION_COMMIT_INPUT_INVALID", cause.message),
      cause,
      { cause },
    );
  }
}
