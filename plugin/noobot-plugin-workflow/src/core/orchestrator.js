/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_BOT_HOOK_POINTS,
  WORKFLOW_HOOKS,
  WORKFLOW_PLUGIN_DEFAULTS,
} from "./constants.js";
import { handleBeforeAgentDispatch } from "./orchestrator/hook-handler.js";
import { registerWorkflowSessionCleanupHook } from "./orchestrator/session-cleanup.js";

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    const disposers = [];
    const hookPoint = WORKFLOW_BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH;

    disposers.push(
      hookManager.on(
        hookPoint,
        async (ctx = {}) => handleBeforeAgentDispatch({
          hookManager,
          options,
          ctx,
          hookPoint,
        }),
        {
          id: WORKFLOW_HOOKS.AFTER_AGENT_DISPATCH_LISTENER_ID,
          priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
          timeoutMs:
            Number(options?.timeoutMs) > 0
              ? Number(options.timeoutMs)
              : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
        },
      ),
    );

    disposers.push(registerWorkflowSessionCleanupHook({ hookManager, options }));

    return disposers;
  };
}

export const registerWorkflowHooks = createRegisterWorkflowHooks();
