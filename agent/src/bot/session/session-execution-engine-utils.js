/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { assertOptionalHookManager } from "@noobot/hook-protocol/runtime";
import { text } from "@noobot/shared/value";

export function normalizeTrimmedStringList(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => text(item)).filter(Boolean);
}

export function selectHookManager({ runConfig, managerKey, createManager }) {
  const existing = runConfig[managerKey];
  if (existing == null) return createManager();
  return assertOptionalHookManager(existing, managerKey);
}
