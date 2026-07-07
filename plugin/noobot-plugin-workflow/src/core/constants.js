/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

export const PLUGIN_NAME = "noobot-plugin-workflow";
export const PLUGIN_VERSION = "4.0.3";

export const WORKFLOW_BOT_HOOK_POINTS = Object.freeze({
  BEFORE_AGENT_DISPATCH: "before_agent_dispatch",
  AFTER_AGENT_DISPATCH: "after_agent_dispatch",
  NODE_AGENT_EXECUTE: "workflow_node_agent_execute",
  AFTER_SESSION_DELETE: "after_session_delete",
});

export const WORKFLOW_HOOKS = Object.freeze({
  AFTER_AGENT_DISPATCH_LISTENER_ID: "workflow_after_agent_dispatch",
  AFTER_SESSION_DELETE_LISTENER_ID: "workflow_after_session_delete",
});

export const WORKFLOW_ACTION = Object.freeze({
  SUBMIT: "submit",
});

export const WORKFLOW_PLUGIN_DEFAULTS = Object.freeze({
  MODE_OFF: "off",
  MODE_ON: "on",
  DEFAULT_LOCALE: "zh-CN",
  DEFAULT_TIMEOUT_MS: TIME_THRESHOLDS.workflow.timeoutMs,
  DEFAULT_PRIORITY: 10,
  DEFAULT_MAX_AUTO_TRANSITIONS: 50,
  DEFAULT_MAX_PARALLEL_NODE_AGENTS: 10,
  DEFAULT_NODE_AGENT_TIMEOUT_MS: TIME_THRESHOLDS.workflow.nodeAgentTimeoutMs,
  DEFAULT_MINI_RUNNER_MAX_TURNS: TURN_THRESHOLDS.workflow.miniRunnerMaxTurns,
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
  MAX_ATTEMPTS: TURN_THRESHOLDS.workflow.retryMaxAttempts,
});

export const WORKFLOW_PROTOCOL = Object.freeze({
  ORCHESTRATION_VERSION: "workflow.orchestration.v2",
});

/**
 * Attachment scope aliases accepted by workflow DSL compatibility layer.
 * Keep legacy zh aliases for backward compatibility with historical plans.
 */
export const WORKFLOW_ATTACHMENT_SCOPE = Object.freeze({
  USER_ALL_TOKENS: Object.freeze(["*", "all", "user:*", "user:all", "\u7528\u6237:*", "\u7528\u6237:\u5168\u90e8"]),
});
