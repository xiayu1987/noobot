/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionJournalError } from "@noobot/session-protocol/partition-journal";
import { requirePartitionMessageRecord } from "@noobot/session-protocol/partition-session-messages";
import { normalizeMessageMetadataEntity } from "../entities/message-entity.js";
import { messageValidationCode } from "./partition-message-input.js";

const deferredContent = [{ path: ["message", "content"] }];

export function partitionMessageMetadataEntity(message) {
  return { value: { message: { ...message, content: null } }, parts: deferredContent };
}

export function checkPartitionMessageStorage(record, { snapshot, scope, messageUid, generation }) {
  requirePartitionMessageRecord(record, { epoch: snapshot.epoch, scope, messageUid, generation });
  try {
    normalizeMessageMetadataEntity(partitionMessageMetadataEntity(record.message));
  } catch (cause) {
    if (messageValidationCode(cause) === null) throw cause;
    throw Object.assign(partitionJournalError("SESSION_STORAGE_CORRUPT", cause.message), { cause });
  }
  return record;
}
