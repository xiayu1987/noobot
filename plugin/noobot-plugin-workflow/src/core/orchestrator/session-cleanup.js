/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_HOOKS } from "../constants.js";
import { cleanupWorkflowBySessionIds } from "../../utils/cleanup.js";
import {
  createSessionDeletionHookResult,
  HOOK_POINT,
  resolveSessionDeletionTargets,
} from "@noobot/hook-protocol";

export function registerWorkflowSessionCleanupHook({ hookManager, options }) {
  return hookManager.on(
    HOOK_POINT.SERVICE.AFTER_SESSION_DELETE,
    async (ctx) => {
      const sessionIds = resolveSessionDeletionTargets(ctx);
      await cleanupWorkflowBySessionIds(ctx.basePath, sessionIds);
      return createSessionDeletionHookResult();
    },
    {
      id: WORKFLOW_HOOKS.AFTER_SESSION_DELETE_LISTENER_ID,
      priority: options.priority,
      timeoutMs: options.timeoutMs,
    },
  );
}
