/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_HOOKS, WORKFLOW_PLUGIN_DEFAULTS } from "./constants.js";
import { normalizeOptions, resolveWorkflowAgentHostCapabilities } from "./options.js";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { handleBeforeAgentDispatch } from "./orchestrator/hook-handler.js";
import { registerWorkflowSessionCleanupHook } from "./orchestrator/session-cleanup.js";
import { createInMemoryWorkflowNodeStateRepository } from "./orchestrator/node-state-repository.js";

export function registerWorkflowAgentHooks({
  hookManager,
  policy,
  config,
  workflowNodeStateRepository = createInMemoryWorkflowNodeStateRepository(),
}) {
  const options = normalizeOptions(config);
  if (!options.enabled || options.mode !== WORKFLOW_PLUGIN_DEFAULTS.MODE_ON) return [];
  if (options.denyToolNames.length) policy.patch({ denyToolNames: options.denyToolNames });
  const disposers = [];
  const hookPoint = HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH;
  const runtimeOptions = {
    ...options,
    ...resolveWorkflowAgentHostCapabilities(config),
    workflowNodeStateRepository,
  };

  disposers.push(
    hookManager.on(
      hookPoint,
      async (ctx = {}) =>
        handleBeforeAgentDispatch({
          hookManager,
          options: runtimeOptions,
          ctx,
          hookPoint,
        }),
      {
        id: WORKFLOW_HOOKS.AFTER_AGENT_DISPATCH_LISTENER_ID,
        priority: runtimeOptions.priority,
        timeoutMs: runtimeOptions.timeoutMs,
      },
    ),
  );

  return disposers;
}

export function registerWorkflowServiceHooks({ hookManager, config }) {
  return [registerWorkflowSessionCleanupHook({ hookManager, options: normalizeOptions(config) })];
}
