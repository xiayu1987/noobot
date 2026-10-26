/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import { text } from "@noobot/shared/value";

export function createRuntimeNodeSessions({
  workflowPayload,
  nodeSessions,
  workflowNodeStateRegistry,
}) {
  return computed(() => {
    const workflowRunId = text(workflowPayload.value?.workflowRunId);
    const committedNodes = workflowNodeStateRegistry.workflows[workflowRunId]?.nodes || {};
    const entries = new Map();
    for (const item of nodeSessions.value) entries.set(item.nodeExecutionId, item);
    for (const committed of Object.values(committedNodes)) {
      const base = entries.get(committed.nodeExecutionId);
      entries.set(committed.nodeExecutionId, base ? { ...base, ...committed } : committed);
    }
    return [...entries.values()];
  });
}
