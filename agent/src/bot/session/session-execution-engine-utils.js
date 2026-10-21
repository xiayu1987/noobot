/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export function normalizeTrimmedStringList(input = []) {
  return (Array.isArray(input) ? input : []).map((item) => text(item)).filter(Boolean);
}

export function selectHookManager({ runConfig = {}, managerKey = "", createManager = null } = {}) {
  if (runConfig?.[managerKey] && typeof runConfig[managerKey] === "object") {
    return runConfig[managerKey];
  }
  return typeof createManager === "function" ? createManager() : null;
}
