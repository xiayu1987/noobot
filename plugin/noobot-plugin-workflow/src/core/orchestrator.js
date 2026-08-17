/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  WORKFLOW_HOOKS,
  WORKFLOW_PLUGIN_DEFAULTS,
} from "./constants.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { handleBeforeAgentDispatch } from "./orchestrator/hook-handler.js";
import { registerWorkflowSessionCleanupHook } from "./orchestrator/session-cleanup.js";
import { createInMemoryWorkflowNodeStateRepository } from "./orchestrator/node-state-repository.js";

export function registerWorkflowAgentHooks({ hookManager, options }) {
  const disposers = [];
  const hookPoint = HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH;
  const workflowNodeStateRepository =
    options?.workflowNodeStateRepository || createInMemoryWorkflowNodeStateRepository();
  const runtimeOptions = {
    ...options,
    workflowNodeStateRepository,
  };

  disposers.push(
    hookManager.on(
      hookPoint,
      async (ctx = {}) => handleBeforeAgentDispatch({
        hookManager,
        options: runtimeOptions,
        ctx,
        hookPoint,
      }),
      {
        id: WORKFLOW_HOOKS.AFTER_AGENT_DISPATCH_LISTENER_ID,
        priority: Number(runtimeOptions.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
        timeoutMs:
          Number(runtimeOptions.timeoutMs) > 0
            ? Number(runtimeOptions.timeoutMs)
            : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
      },
    ),
  );

  return disposers;
}

export function registerWorkflowServiceHooks({ hookManager, options }) {
  return [registerWorkflowSessionCleanupHook({ hookManager, options })];
}

export function createRegisterWorkflowHooks() {
  return function registerWorkflowHooks({ hookManager, options }) {
    return [
      ...registerWorkflowAgentHooks({ hookManager, options }),
      ...registerWorkflowServiceHooks({ hookManager, options }),
    ];
  };
}

export const registerWorkflowHooks = createRegisterWorkflowHooks();
