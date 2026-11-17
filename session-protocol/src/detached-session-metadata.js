/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text } from "@noobot/shared/value";

const HOST_FIELDS = new Set([
  "userId",
  "sessionId",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "runtimePluginState",
]);

export function requireDetachedSessionMetadata(source) {
  if (!isPlainObject(source) || !text(source.scope))
    throw new TypeError("detached sub-session requires metadata.scope");
  const reserved = Object.keys(source).filter((field) => HOST_FIELDS.has(field));
  if (reserved.length) {
    const error = new TypeError(
      `detached sub-session metadata contains host-owned fields: ${reserved.join(", ")}`,
    );
    error.code = "SESSION_DETACHED_METADATA_INVALID";
    throw error;
  }
  return source;
}
