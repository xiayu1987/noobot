/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_HOOKS } from "../constants.js";
import {
  cleanupWorkflowBySessionIds,
  collectWorkflowRelatedSessionIds,
} from "../../utils/cleanup.js";
import {
  createSessionDeletionHookResult,
  HOOK_POINT,
  resolveSessionDeletionTargets,
} from "@noobot/hook-protocol";
import { text } from "@noobot/shared/value";

export function registerWorkflowSessionCleanupHook({ hookManager, options }) {
  return hookManager.on(
    HOOK_POINT.SERVICE.AFTER_SESSION_DELETE,
    async (ctx = {}) => {
      const sessionIds = resolveSessionDeletionTargets(ctx);
      const basePath = text(ctx?.basePath);
      if (!basePath) throw new TypeError("workflow session cleanup requires basePath");
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
      priority: options.priority,
      timeoutMs: options.timeoutMs,
    },
  );
}
