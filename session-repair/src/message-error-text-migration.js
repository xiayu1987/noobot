/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ARTIFACT_MESSAGE_ERROR_TEXT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";

export const SESSION_MESSAGE_ERROR_TEXT_MIGRATION = "message-error-text-v15";

export function migrateMessageErrorText(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_MESSAGE_ERROR_TEXT_SCHEMA_VERSION) return;
  let migrated = false;
  for (const message of context.next.messages) {
    if (!isPlainObject(message) || !Object.hasOwn(message, "error")) continue;
    if (typeof message.error === "string") continue;
    delete message.error;
    migrated = true;
  }
  if (!migrated) return;
  context.changed = true;
  context.migrations.push(SESSION_MESSAGE_ERROR_TEXT_MIGRATION);
}
