/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MESSAGE_ORIGIN,
  SESSION_ARTIFACT_MESSAGE_ENTITY_CONTRACT_SCHEMA_VERSION,
  isDialogUserMessageRecord,
  isMessageOrigin,
} from "@noobot/session-protocol";
import { text } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export const SESSION_MESSAGE_ENTITY_CONTRACT_MIGRATION = "message-entity-contract-v17";

function unmigratable(context, message, reason) {
  return Object.assign(
    new TypeError(
      `Session ${context.sessionId} message ${message.messageUid} entity is unmigratable: ${reason}`,
    ),
    { code: SESSION_REPAIR_ERROR_CODE.MESSAGE_ENTITY_UNMIGRATABLE },
  );
}

function migrateMessageOriginBackfillingRootSessionAsNatural(context, message) {
  if (!isDialogUserMessageRecord(message)) {
    if (!Object.hasOwn(message, "messageOrigin")) return false;
    delete message.messageOrigin;
    return true;
  }
  if (isMessageOrigin(message.messageOrigin)) return false;
  if (Object.hasOwn(message, "messageOrigin")) {
    throw unmigratable(context, message, "message_origin_invalid");
  }
  if (text(context.next.parentSessionId)) {
    throw unmigratable(context, message, "child_session_message_origin_missing");
  }
  message.messageOrigin = MESSAGE_ORIGIN.NATURAL;
  return true;
}

function migrateAttachments(context, message) {
  if (Array.isArray(message.attachments)) return false;
  if (Object.hasOwn(message, "attachments")) {
    throw unmigratable(context, message, "attachments_invalid");
  }
  message.attachments = [];
  return true;
}

export function migrateMessageEntityContract(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_MESSAGE_ENTITY_CONTRACT_SCHEMA_VERSION) {
    return;
  }
  let migrated = false;
  for (const message of context.next.messages) {
    if (typeof message.content !== "string") {
      throw unmigratable(context, message, "content_not_string");
    }
    const attachmentsChanged = migrateAttachments(context, message);
    const originChanged = migrateMessageOriginBackfillingRootSessionAsNatural(context, message);
    migrated ||= attachmentsChanged || originChanged;
  }
  if (!migrated) return;
  context.changed = true;
  context.migrations.push(SESSION_MESSAGE_ENTITY_CONTRACT_MIGRATION);
}
