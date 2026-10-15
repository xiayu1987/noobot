/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isPlainObject, text } from "@noobot/shared/value";
function normalizeWorkflowMeta(messageItem = {}) {
  return isPlainObject(messageItem?.pluginMeta) ? messageItem.pluginMeta : null;
}

function isWorkflowMessageLike(messageItem = {}) {
  const type = text(messageItem?.type).toLowerCase();
  const workflowMeta = normalizeWorkflowMeta(messageItem);
  const source = text(workflowMeta?.source).toLowerCase();
  const kind = text(workflowMeta?.kind).toLowerCase();
  const phase = text(workflowMeta?.phase).toLowerCase();
  return (
    type === "workflow" && source === "workflow-plugin" && kind === "workflow" && Boolean(phase)
  );
}

export { isWorkflowMessageLike, normalizeWorkflowMeta };
