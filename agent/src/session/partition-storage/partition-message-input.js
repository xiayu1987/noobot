/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { AttachmentProtocolError } from "@noobot/attachment-protocol";
import { MutationRefInputError } from "@noobot/file-mutation-protocol";
import { ResourceRefInputError } from "@noobot/path-resolver";
import { PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE } from "@noobot/plugin-protocol/plugin-message-payload";
import {
  isTransferIdentityConflict,
  TransferEnvelopeInputError,
} from "@noobot/semantic-transfer-protocol";
import {
  SESSION_MESSAGE_ENTITY_INVALID,
  SESSION_MESSAGE_IDENTITY_INVALID,
} from "@noobot/session-protocol";
import { SessionCommitInputError } from "@noobot/session-protocol/session-changes";
import { PartitionAdmissionRejection } from "@noobot/session-protocol/partition-journal";
import { requirePartitionMessageChanges } from "@noobot/session-protocol/partition-session-messages";
import { normalizeMessageEntity } from "../entities/message-entity.js";

export function messageValidationCode(cause) {
  if (
    cause?.code === SESSION_MESSAGE_ENTITY_INVALID ||
    cause?.code === SESSION_MESSAGE_IDENTITY_INVALID ||
    Object.values(PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE).includes(cause?.code) ||
    cause instanceof SessionCommitInputError ||
    isTransferIdentityConflict(cause)
  )
    return cause.code;
  if (
    cause instanceof AttachmentProtocolError ||
    cause instanceof MutationRefInputError ||
    cause instanceof ResourceRefInputError ||
    cause instanceof TransferEnvelopeInputError
  )
    return "SESSION_COMMIT_INPUT_INVALID";
  return null;
}

export function rejectMessageInput(cause) {
  const code = messageValidationCode(cause);
  if (code === null) throw cause;
  throw Object.assign(new PartitionAdmissionRejection(code, cause.message), { cause });
}

export function normalizePartitionMessageChanges(input) {
  try {
    const { changes, committedAt, entities } = requirePartitionMessageChanges(input);
    const {
      messages = [],
      messageDiagnostics = [],
      messageContentAppends = [],
      messageContentReplacements = [],
      messageMetadataUpdates = [],
      sessionMetadata,
      scopedMetadata,
      turnTransition,
      summaryCheckpoints = [],
      timings = [],
      userMetaParsedResult,
      attachmentBinding,
      messageDeletion,
      turnReplacement,
      deliveries,
      outboxCursors,
      outboxMaintenance,
      artifactEvents = [],
    } = changes;
    return {
      entities,
      committedAt,
      changes: {
        messages: messages.map(normalizeMessageEntity),
        messageDiagnostics,
        messageContentAppends,
        messageContentReplacements,
        messageMetadataUpdates,
        sessionMetadata,
        scopedMetadata,
        turnTransition,
        summaryCheckpoints,
        timings,
        userMetaParsedResult,
        attachmentBinding,
        messageDeletion,
        turnReplacement,
        deliveries,
        outboxCursors,
        outboxMaintenance,
        artifactEvents,
      },
    };
  } catch (cause) {
    rejectMessageInput(cause);
  }
}
