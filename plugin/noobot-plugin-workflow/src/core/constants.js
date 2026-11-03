/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { resolvePluginDataRelativePath } from "@noobot/workspace-protocol";

export const PLUGIN_ID = "workflow";
export const PLUGIN_NAME = "noobot-plugin-workflow";
export const PLUGIN_VERSION = "4.4.2";

export const WORKFLOW_DATA_SCOPE = Object.freeze({
  SESSION: "session",
});

export function resolveWorkflowDataRelativePath(...segments) {
  return resolvePluginDataRelativePath(PLUGIN_ID, ...segments);
}

export const WORKFLOW_HOOKS = Object.freeze({
  BEFORE_AGENT_DISPATCH_LISTENER_ID: "workflow_before_agent_dispatch",
  AFTER_SESSION_DELETE_LISTENER_ID: "workflow_after_session_delete",
});

export const WORKFLOW_PLUGIN_DEFAULTS = Object.freeze({
  MODE_OFF: "off",
  MODE_ON: "on",
  DEFAULT_PRIORITY: 10,
  DEFAULT_MAX_AUTO_TRANSITIONS: 50,
  DEFAULT_MAX_PARALLEL_NODE_AGENTS: 10,
});

export const WORKFLOW_SEMANTIC = Object.freeze({
  PURPOSE: "workflow_semantic",
  DOMAIN: "workflow",
});

export const WORKFLOW_TRACE = Object.freeze({
  TYPE: "workflow_plugin",
  STAGE_EXECUTED: "workflow_executed",
  STAGE_FAILED: "workflow_failed",
});

export const WORKFLOW_ATTACHMENT_SCOPE = Object.freeze({
  USER_ALL: "user:*",
});
