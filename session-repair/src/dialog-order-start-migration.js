/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ARTIFACT_DIALOG_ORDER_START_SCHEMA_VERSION } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";

const SESSION_DIALOG_ORDER_START_MIGRATION = "session-dialog-order-start-v22";

export function migrateDialogOrderStart(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_DIALOG_ORDER_START_SCHEMA_VERSION) return;
  let migrated = false;
  for (const entry of context.next.dialogOrder) {
    if (isPlainObject(entry) && Object.hasOwn(entry, "startedAt")) {
      delete entry.startedAt;
      migrated = true;
    }
  }
  if (!migrated) return;
  context.changed = true;
  context.migrations.push(SESSION_DIALOG_ORDER_START_MIGRATION);
}
