/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HOOK_PROTOCOL_VERSION = 2;

export const HOOK_EXECUTION = Object.freeze({
  SEQUENTIAL: "sequential",
  PARALLEL: "parallel",
});

export const HOOK_FAILURE_MODE = Object.freeze({
  CONTINUE: "continue",
  FAIL_FLOW: "fail_flow",
});

export const HOOK_POINT = Object.freeze({
  AGENT: Object.freeze({
    BEFORE_TURN: "agent.before_turn",
    AFTER_TURN: "agent.after_turn",
    ON_ERROR: "agent.on_error",
    ON_ABORT: "agent.on_abort",
    BEFORE_CONTEXT_BUILD: "agent.before_context_build",
    AFTER_CONTEXT_BUILD: "agent.after_context_build",
    CONTEXT_BUILD_ERROR: "agent.context_build_error",
    BEFORE_LLM_CALL: "agent.before_llm_call",
    AFTER_LLM_CALL: "agent.after_llm_call",
    LLM_CALL_ERROR: "agent.llm_call_error",
    BEFORE_TOOL_CALLS: "agent.before_tool_calls",
    AFTER_TOOL_CALLS: "agent.after_tool_calls",
    BEFORE_TOOL_CALL: "agent.before_tool_call",
    AFTER_TOOL_CALL: "agent.after_tool_call",
    TOOL_CALL_ERROR: "agent.tool_call_error",
    BEFORE_STATE_COMMIT: "agent.before_state_commit",
    AFTER_STATE_COMMIT: "agent.after_state_commit",
    BEFORE_FINAL_OUTPUT: "agent.before_final_output",
    SEMANTIC_TRANSFER_VALIDATION: "agent.semantic_transfer_validation",
  }),
  BOT: Object.freeze({
    BEFORE_SESSION_RUN: "bot.before_session_run",
    BEFORE_AGENT_DISPATCH: "bot.before_agent_dispatch",
    AFTER_AGENT_DISPATCH: "bot.after_agent_dispatch",
    AGENT_DISPATCH_ERROR: "bot.agent_dispatch_error",
    AFTER_SESSION_RUN: "bot.after_session_run",
    SESSION_RUN_ERROR: "bot.session_run_error",
  }),
  SERVICE: Object.freeze({
    AFTER_SESSION_DELETE: "service.after_session_delete",
  }),
  WORKFLOW: Object.freeze({
    NODE_AGENT_EXECUTE: "workflow.node_agent_execute",
  }),
});

const failFlowPoints = new Set([
  HOOK_POINT.AGENT.BEFORE_CONTEXT_BUILD,
  HOOK_POINT.AGENT.BEFORE_TURN,
  HOOK_POINT.AGENT.BEFORE_LLM_CALL,
  HOOK_POINT.AGENT.BEFORE_TOOL_CALLS,
  HOOK_POINT.AGENT.BEFORE_TOOL_CALL,
  HOOK_POINT.AGENT.BEFORE_STATE_COMMIT,
  HOOK_POINT.AGENT.BEFORE_FINAL_OUTPUT,
  HOOK_POINT.BOT.BEFORE_SESSION_RUN,
  HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH,
]);

const allHookPoints = Object.values(HOOK_POINT).flatMap((domain) => Object.values(domain));

export const HOOK_POINT_DESCRIPTORS = Object.freeze(
  Object.fromEntries(
    allHookPoints.map((point) => [
      point,
      Object.freeze({
        protocolVersion: HOOK_PROTOCOL_VERSION,
        point,
        execution: HOOK_EXECUTION.SEQUENTIAL,
        failureMode: failFlowPoints.has(point)
          ? HOOK_FAILURE_MODE.FAIL_FLOW
          : HOOK_FAILURE_MODE.CONTINUE,
      }),
    ]),
  ),
);

export function requireHookPointDescriptor(point = "") {
  const normalizedPoint = String(point || "").trim();
  const descriptor = HOOK_POINT_DESCRIPTORS[normalizedPoint];
  if (!descriptor) throw new TypeError(`unknown hook point: ${normalizedPoint || "<empty>"}`);
  return descriptor;
}
