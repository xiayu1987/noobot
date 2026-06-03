/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { normalizeOptions } from "./options.js";
import { formatWorkflowCoreError } from "./error-messages.js";

export function assertHookManager(hookManager = null) {
  if (!hookManager || typeof hookManager.on !== "function") {
    throw new Error(formatWorkflowCoreError("HOOK_MANAGER_REQUIRED"));
  }
}

export function createPluginRuntimeContext(api = {}, userOptions = {}) {
  const options = normalizeOptions(userOptions);
  const botHookManager =
    api?.botHookManager && typeof api.botHookManager === "object"
      ? api.botHookManager
      : api?.hookManager && typeof api.hookManager === "object"
        ? api.hookManager
        : null;
  return {
    options,
    hookManager: botHookManager,
  };
}
