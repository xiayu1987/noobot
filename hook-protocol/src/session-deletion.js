/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

export function requireSessionDeletionHookContext(context) {
  if (!isPlainObject(context)) throw new TypeError("session deletion requires a hook context");
  const { userId, deletionKey, deletedSessionIds, basePath } = context;
  if (![userId, deletionKey, basePath].every(isCanonicalText))
    throw new TypeError("session deletion hook requires userId, deletionKey and basePath");
  if (
    !Array.isArray(deletedSessionIds) ||
    !deletedSessionIds.length ||
    !Array.from(deletedSessionIds).every(isCanonicalText) ||
    new Set(deletedSessionIds).size !== deletedSessionIds.length
  )
    throw new TypeError(
      "session deletion hook context requires unique canonical deletedSessionIds",
    );
  return Object.freeze({ ...context, deletedSessionIds: Object.freeze([...deletedSessionIds]) });
}

export function requireSessionDeletionHookCompletion({ outcomes }) {
  for (const { handlerId, value } of outcomes) {
    if (value !== undefined) {
      throw new TypeError(
        `session deletion handler ${handlerId} must complete without returning session ownership claims`,
      );
    }
  }
}
