/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ARTIFACT_DIALOG_ORDER_START_SCHEMA_VERSION } from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";

export const SESSION_DIALOG_ORDER_START_MIGRATION = "session-dialog-order-start-v22";

// dialogOrder[].startedAt 是锚点用户消息 ts 的重复存储，且无任何读取方；
// 起点事实只保留在消息 ts 上，这里剥离存量字段。
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
