/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { SESSION_CALLER, isSessionCaller } from "@noobot/shared/session-caller";
import { isPlainObject } from "@noobot/shared/value";

export const SESSION_CALLER_MIGRATION = "session-caller-explicit-user-v1";

export function resolveRepairedSessionCaller(document) {
  if (isPlainObject(document) && isSessionCaller(document.caller)) {
    return { caller: document.caller, repaired: false };
  }
  return { caller: SESSION_CALLER.USER, repaired: true };
}

export function migrateSessionCaller(context) {
  const { caller, repaired } = resolveRepairedSessionCaller(context.next);
  if (!repaired) return;
  context.next.caller = caller;
  context.changed = true;
  context.migrations.push(SESSION_CALLER_MIGRATION);
}
