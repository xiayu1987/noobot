/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { assertSessionArtifactEvents } from "@noobot/event-protocol";
import {
  SESSION_ARTIFACT_EVENTS_CONTRACT_SCHEMA_VERSION,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export function migrateSessionArtifactEvents(context) {
  const { next, sourceSchemaVersion } = context;
  if (
    !Object.hasOwn(next, "sessionArtifactEvents") &&
    sourceSchemaVersion < SESSION_ARTIFACT_EVENTS_CONTRACT_SCHEMA_VERSION
  ) {
    next.sessionArtifactEvents = [];
    context.changed = true;
    context.migrations.push("session-artifact-events-v20");
  }
  try {
    assertSessionArtifactEvents(next.sessionArtifactEvents, next.sessionId);
  } catch (cause) {
    if (cause.code !== SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID) throw cause;
    throw Object.assign(
      new TypeError("Session artifact event collection cannot be migrated", { cause }),
      {
        code: SESSION_REPAIR_ERROR_CODE.ARTIFACT_FIELD_SCHEMA_MISMATCH,
      },
    );
  }
}
