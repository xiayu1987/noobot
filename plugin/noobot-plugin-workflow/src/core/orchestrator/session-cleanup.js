/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_HOOKS, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import {
  cleanupWorkflowBySessionIds,
  collectWorkflowRelatedSessionIds,
} from "../../utils/cleanup.js";
import {
  createSessionDeletionHookResult,
  HOOK_POINT,
  resolveSessionDeletionTargets,
} from "@noobot/hook-protocol";

export function registerWorkflowSessionCleanupHook({ hookManager, options = {} } = {}) {
  return hookManager.on(
    HOOK_POINT.SERVICE.AFTER_SESSION_DELETE,
    async (ctx = {}) => {
      const sessionIds = resolveSessionDeletionTargets(ctx);
      if (!sessionIds.length) return createSessionDeletionHookResult();
      const basePath = String(ctx?.basePath || "").trim();
      if (!basePath) return createSessionDeletionHookResult();
      const cleanup = await cleanupWorkflowBySessionIds(basePath, sessionIds);
      const retainedRelatedSessionIds = await collectWorkflowRelatedSessionIds(
        basePath,
        ctx?.remainingSessionIds,
      );
      return createSessionDeletionHookResult({
        deletedRelatedSessionIds: cleanup.relatedSessionIds,
        retainedRelatedSessionIds,
      });
    },
    {
      id: WORKFLOW_HOOKS.AFTER_SESSION_DELETE_LISTENER_ID,
      priority: Number(options?.priority) || WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_PRIORITY,
      timeoutMs:
        Number(options?.timeoutMs) > 0
          ? Number(options.timeoutMs)
          : WORKFLOW_PLUGIN_DEFAULTS.DEFAULT_TIMEOUT_MS,
    },
  );
}
