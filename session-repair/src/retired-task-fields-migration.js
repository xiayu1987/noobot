/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ARTIFACT_RETIRED_TASK_FIELDS_SCHEMA_VERSION } from "@noobot/session-protocol";

export const SESSION_RETIRED_TASK_FIELDS_MIGRATION = "retired-task-fields-v18";

const RETIRED_SESSION_FIELDS = Object.freeze(["currentTaskId"]);
const RETIRED_MESSAGE_FIELDS = Object.freeze(["taskId", "taskStatus"]);

function dropFields(target, fields) {
  let dropped = false;
  for (const field of fields) {
    if (!Object.hasOwn(target, field)) continue;
    delete target[field];
    dropped = true;
  }
  return dropped;
}

export function migrateRetiredTaskFields(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_RETIRED_TASK_FIELDS_SCHEMA_VERSION) return;
  let migrated = dropFields(context.next, RETIRED_SESSION_FIELDS);
  for (const message of context.next.messages) {
    migrated = dropFields(message, RETIRED_MESSAGE_FIELDS) || migrated;
  }
  if (!migrated) return;
  context.changed = true;
  context.migrations.push(SESSION_RETIRED_TASK_FIELDS_MIGRATION);
}
