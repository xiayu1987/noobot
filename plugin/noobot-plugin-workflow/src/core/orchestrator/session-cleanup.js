/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_HOOKS } from "../constants.js";
import { cleanupWorkflowBySessionIds } from "../../utils/cleanup.js";
import { HOOK_POINT, requireSessionDeletionHookContext } from "@noobot/hook-protocol";

export function registerWorkflowSessionCleanupHook({ hookManager, options }) {
  return hookManager.on(
    HOOK_POINT.SERVICE.AFTER_SESSION_DELETE,
    async (ctx) => {
      const { deletedSessionIds: sessionIds } = requireSessionDeletionHookContext(ctx);
      await cleanupWorkflowBySessionIds(ctx.basePath, sessionIds);
    },
    {
      id: WORKFLOW_HOOKS.AFTER_SESSION_DELETE_LISTENER_ID,
      priority: options.priority,
      timeoutMs: options.timeoutMs,
    },
  );
}
