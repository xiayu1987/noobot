/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_ARTIFACT_TURN_TIMING_LIFECYCLE_START_SCHEMA_VERSION } from "@noobot/session-protocol";
import { isPlainObject, text } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export const SESSION_TURN_TIMING_LIFECYCLE_START_MIGRATION = "turn-timing-lifecycle-start-v16";

function assertSameStart(timing, lifecycleTurn) {
  if (!lifecycleTurn) return;
  if (text(lifecycleTurn.startedAt) === text(timing.thinkingStartedAt)) return;
  throw Object.assign(
    new TypeError(`Turn timing start conflicts with lifecycle start: ${timing.turnScopeId}`),
    { code: SESSION_REPAIR_ERROR_CODE.TURN_TIMING_START_CONFLICT },
  );
}

function hasTimingFact(timing) {
  return Boolean(text(timing.thinkingFinishedAt)) || Boolean(timing.modelLoopRound);
}

export function migrateTurnTimingLifecycleStart(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_TURN_TIMING_LIFECYCLE_START_SCHEMA_VERSION) {
    return;
  }
  let migrated = false;
  const retained = [];
  for (const timing of context.next.turnTimings) {
    if (isPlainObject(timing) && Object.hasOwn(timing, "thinkingStartedAt")) {
      assertSameStart(timing, context.turns[text(timing.turnScopeId)]);
      delete timing.thinkingStartedAt;
      migrated = true;
    }
    if (isPlainObject(timing) && hasTimingFact(timing)) {
      retained.push(timing);
    } else {
      migrated = true;
    }
  }
  if (!migrated) return;
  context.next.turnTimings = retained;
  context.changed = true;
  context.migrations.push(SESSION_TURN_TIMING_LIFECYCLE_START_MIGRATION);
}
