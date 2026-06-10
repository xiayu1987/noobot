/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_BOT_HOOK_POINTS, WORKFLOW_HOOKS, WORKFLOW_PLUGIN_DEFAULTS } from "../constants.js";
import { cleanupWorkflowBySessionIds } from "../../utils/cleanup.js";

export function registerWorkflowSessionCleanupHook({ hookManager, options = {} } = {}) {
  return hookManager.on(
    WORKFLOW_BOT_HOOK_POINTS.AFTER_SESSION_DELETE,
    async (ctx = {}) => {
      const deletedSessionIds = Array.isArray(ctx?.deletedSessionIds)
        ? ctx.deletedSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
      const fallbackSessionId = String(ctx?.sessionId || "").trim();
      const sessionIds = deletedSessionIds.length
        ? deletedSessionIds
        : fallbackSessionId
          ? [fallbackSessionId]
          : [];
      if (!sessionIds.length) return;
      const basePath = String(ctx?.basePath || "").trim();
      if (!basePath) return;
      await cleanupWorkflowBySessionIds(basePath, sessionIds);
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
