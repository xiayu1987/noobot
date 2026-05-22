/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  ACCEPTANCE_MODE,
  BLOCKED_AGENT_TOOL_NAMES,
  TASK_ACCEPTANCE_TOOL_NAME,
  disableBlockedCalls,
  disableBlockedToolsInRegistry,
} from "./deps.js";
import {
  maybeCaptureAcceptanceSemanticValidationByInject,
  maybeInjectAcceptanceSemanticValidationPrompt,
} from "./validation-runner.js";
import { maybeAttachChecklistArtifactsAtFinalOutput, maybeForceAcceptanceAtFinalOutput } from "./output-finalizer.js";
import { ensureTaskAcceptanceTool } from "./tool-injector.js";

async function handleAcceptanceLifecycle(point = "", ctx = {}, meta = {}) {
  let changed = false;
  if (point === "before_turn") {
    changed = disableBlockedToolsInRegistry(ctx) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_calls") {
    changed = disableBlockedCalls(ctx?.calls || []) || changed;
    changed = ensureTaskAcceptanceTool(ctx, meta) || changed;
  }
  if (point === "before_tool_call" && BLOCKED_AGENT_TOOL_NAMES.has(String(ctx?.call?.name || "").trim())) {
    ctx.call.name = TASK_ACCEPTANCE_TOOL_NAME;
    ctx.call.args = { mode: ACCEPTANCE_MODE.ACTIVE };
    changed = true;
  }
  if (point === "before_final_output") {
    changed = (await maybeForceAcceptanceAtFinalOutput(ctx, meta)) || changed;
    changed = (await maybeAttachChecklistArtifactsAtFinalOutput(ctx)) || changed;
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
