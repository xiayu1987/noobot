/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolveRuntimeNodeSession } from "./workflowUnifiedSessionDetail.js";
import { workflowSessionText as text } from "./workflowNodeSessionProjection.js";

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

export function resolveCanonicalWorkflowNodeItem(nodeItem = {}, runtimeNodeSessions = []) {
  const runtimeNode = resolveRuntimeNodeSession(nodeItem, runtimeNodeSessions);
  return {
    ...(nodeItem && typeof nodeItem === "object" ? nodeItem : {}),
    ...(runtimeNode && typeof runtimeNode === "object" ? runtimeNode : {}),
    rootSessionId: text(runtimeNode?.rootSessionId || nodeItem?.rootSessionId),
  };
}

export function isSameWorkflowDrawerRoute(left = {}, right = {}) {
  const leftDialogProcessId = text(left?.dialogProcessId);
  const leftRootSessionId = text(left?.rootSessionId);
  return Boolean(
    leftDialogProcessId && leftRootSessionId &&
    leftDialogProcessId === text(right?.dialogProcessId) &&
    leftRootSessionId === text(right?.rootSessionId),
  );
}
