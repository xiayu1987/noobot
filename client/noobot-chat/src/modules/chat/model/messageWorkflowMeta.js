/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

function normalizeWorkflowMeta(messageItem = {}) {
  return messageItem?.pluginMeta &&
    typeof messageItem.pluginMeta === "object" &&
    !Array.isArray(messageItem.pluginMeta)
    ? messageItem.pluginMeta
    : null;
}

function isWorkflowMessageLike(messageItem = {}) {
  const type = String(messageItem?.type || "")
    .trim()
    .toLowerCase();
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  const source = String(workflowMeta?.source || "")
    .trim()
    .toLowerCase();
  const kind = String(workflowMeta?.kind || "")
    .trim()
    .toLowerCase();
  const phase = String(workflowMeta?.phase || "")
    .trim()
    .toLowerCase();
  return (
    type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase)
  );
}

export { isWorkflowMessageLike, normalizeWorkflowMeta };
