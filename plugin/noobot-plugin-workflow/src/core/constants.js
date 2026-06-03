/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const PLUGIN_NAME = "noobot-plugin-workflow";
export const PLUGIN_VERSION = "0.1.0";

export const WORKFLOW_BOT_HOOK_POINTS = Object.freeze({
  AFTER_AGENT_DISPATCH: "after_agent_dispatch",
  NODE_AGENT_EXECUTE: "workflow_node_agent_execute",
});

export const WORKFLOW_HOOKS = Object.freeze({
  AFTER_AGENT_DISPATCH_LISTENER_ID: "workflow_after_agent_dispatch",
});

export const WORKFLOW_ACTION = Object.freeze({
  SUBMIT: "submit",
});

export const WORKFLOW_PLUGIN_DEFAULTS = Object.freeze({
  MODE_OFF: "off",
  MODE_ON: "on",
  DEFAULT_LOCALE: "zh-CN",
  DEFAULT_TIMEOUT_MS: 180000,
  DEFAULT_PRIORITY: 10,
  DEFAULT_MAX_AUTO_TRANSITIONS: 10,
});

export const WORKFLOW_SEMANTIC = Object.freeze({
  PURPOSE: "workflow_semantic",
  DOMAIN: "workflow",
  MODE_SEPARATE_MODEL: "separate_model",
  MODE_INLINE_TEXT: "inline_text",
});

export const WORKFLOW_TRACE = Object.freeze({
  TYPE: "workflow_plugin",
  STAGE_EXECUTED: "workflow_executed",
  STAGE_FAILED: "workflow_failed",
});

export const WORKFLOW_PHASES = Object.freeze({
  HOOK_RECEIVED: "hook_received",
  SEMANTIC_RESOLUTION: "semantic_resolution",
  WORKFLOW_EXECUTION: "workflow_execution",
  PAYLOAD_BUILD: "payload_build",
});

export const WORKFLOW_PHASE_STATUS = Object.freeze({
  STARTED: "started",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  SKIPPED: "skipped",
});

export const WORKFLOW_RETRY = Object.freeze({
  POLICY_SINGLE_SHOT: "single_shot",
  MAX_ATTEMPTS: 1,
});

export const WORKFLOW_PROTOCOL = Object.freeze({
  ORCHESTRATION_VERSION: "workflow.orchestration.v2",
});
