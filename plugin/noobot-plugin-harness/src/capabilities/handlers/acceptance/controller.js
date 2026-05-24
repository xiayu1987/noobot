/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  BLOCKED_AGENT_TOOL_NAMES,
  LLM_SUMMARY_OVERFLOW_POLICY,
  TASK_ACCEPTANCE_TOOL_NAME,
  disableBlockedCalls,
  disableBlockedToolsInRegistry,
  ensureHarnessBucket,
} from "./deps.js";
import {
  maybeCaptureAcceptanceSemanticValidationByInject,
  maybeInjectAcceptanceSemanticValidationPrompt,
} from "./validation-runner.js";
import { maybeAttachChecklistArtifactsAtFinalOutput, maybeForceAcceptanceAtFinalOutput } from "./output-finalizer.js";
import { ensureTaskAcceptanceTool } from "./tool-injector.js";

async function handleAcceptanceLifecycle(point = "", ctx = {}, meta = {}) {
  let changed = false;
  const holder = ensureHarnessBucket(ctx);
  const forceAcceptanceDueToOverflow =
    LLM_SUMMARY_OVERFLOW_POLICY.FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW === true &&
    holder?.state?.flags?.overflowForceAcceptancePending === true;
  if (point === "before_turn") {
    changed = disableBlockedToolsInRegistry(ctx) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_calls") {
    if (forceAcceptanceDueToOverflow && Array.isArray(ctx?.calls) && ctx.calls.length) {
      const firstCall = ctx.calls[0] || {};
      firstCall.name = TASK_ACCEPTANCE_TOOL_NAME;
      firstCall.args = { mode: ACCEPTANCE_MODE.FORCED };
      ctx.calls.length = 1;
      ctx.calls[0] = firstCall;
      changed = true;
    }
    changed = disableBlockedCalls(ctx?.calls || []) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_call" && BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())) {
    ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
    ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
    changed = true;
  }
  if (point === "before_tool_call" && forceAcceptanceDueToOverflow) {
    ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
    ctx.call.args = { mode: ACCEPTANCE_MODE.FORCED };
    changed = true;
  }
  if (point === "before_llm_call" && forceAcceptanceDueToOverflow) {
    if (Array.isArray(ctx?.messages)) {
      ctx.messages.unshift({
        role: "system",
        content:
          "Context overflow remains after summary/pruning. Call request_task_acceptance with mode=forced now.",
      });
      changed = true;
    }
  }
  if (point === "before_final_output") {
    changed = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || changed;
    changed = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || changed;
    if (holder?.state?.flags?.overflowForceAcceptancePending === true) {
      holder.state.flags.overflowForceAcceptancePending = false;
      changed = true;
    }
  }
  if (point === "before_llm_call") {
    changed = maybeInjectAcceptanceSemanticValidationPrompt(ctx) || changed;
  }
  if (point === "after_llm_call") {
    changed = maybeCaptureAcceptanceSemanticValidationByInject(ctx) || changed;
  }
  return changed;
}

export function createAcceptanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    if (
      ["before_tool_calls", "before_tool_call", "after_tool_call", "tool_call_error"].includes(
        String(point || "").trim(),
      ) &&
      !shouldProcessPrimaryToolHooks(ctx)
    ) {
      return { capability, point, status: "active", changed: false };
    }
    const changed = await handleAcceptanceLifecycle(point, ctx, meta);
    return { capability, point, status: "active", changed };
  };
}

export { ensureTaskAcceptanceTool };
