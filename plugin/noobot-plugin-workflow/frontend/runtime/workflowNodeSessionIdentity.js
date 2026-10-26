/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimeNodeSession } from "./workflowUnifiedSessionDetail.js";
import { text } from "@noobot/shared/value";
export function shouldRejectRootSessionProjection({
  currentSessionId = "",
  incomingSessionId = "",
  rootSessionId = "",
} = {}) {
  const current = text(currentSessionId);
  const incoming = text(incomingSessionId);
  const root = text(rootSessionId);
  return Boolean(current && incoming && root && current !== root && incoming === root);
}

export function resolveCanonicalWorkflowNodeItem(nodeItem, runtimeNodeSessions) {
  return {
    ...nodeItem,
    ...resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions),
    rootSessionId: nodeItem.rootSessionId,
  };
}

export function isSameWorkflowDrawerRoute(left = {}, right = {}) {
  const leftDialogProcessId = text(left?.dialogProcessId);
  const leftRootSessionId = text(left?.rootSessionId);
  return Boolean(
    leftDialogProcessId &&
    leftRootSessionId &&
    leftDialogProcessId === text(right?.dialogProcessId) &&
    leftRootSessionId === text(right?.rootSessionId),
  );
}
