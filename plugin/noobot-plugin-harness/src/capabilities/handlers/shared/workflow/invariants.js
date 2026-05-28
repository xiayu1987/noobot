/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { appendCapabilityLog } from "../attachment-log-utils.js";

const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;

function ensureObject(source = {}) {
  return source && typeof source === "object" ? source : {};
}

export function enforceWorkflowInvariants(ctx = {}, { domain = "" } = {}) {
  const harness = ctx?.agentContext?.payload?.harness;
  if (!harness || typeof harness !== "object") return false;
  const state = ensureObject(harness.state);
  harness.state = state;
  state.pending = ensureObject(state.pending);
  state.flags = ensureObject(state.flags);
  let changed = false;
  const violations = [];

  if (state.pending.planUpdate === true) {
    const stageRaw = String(state.pending.planUpdateStage || "").trim().toLowerCase();
    if (stageRaw !== "revision" && stageRaw !== "refinement") {
      state.pending.planUpdateStage = "revision";
      changed = true;
      violations.push("pending.planUpdateStage_missing_or_invalid");
    }
    if (!state.pending.planUpdateContext || typeof state.pending.planUpdateContext !== "object") {
      state.pending.planUpdateContext = { summaryText: "", targetMainStepIndexes: [] };
      changed = true;
      violations.push("pending.planUpdateContext_missing");
    }
  }

  if (state.flags.summaryByCharsPrompted === true && state.pending.summary !== true) {
    state.flags.summaryByCharsPrompted = false;
    changed = true;
    violations.push("flags.summaryByCharsPrompted_without_pending_summary");
  }

  if (!changed) return false;
  appendCapabilityLog(ctx, {
    domain: String(domain || "guidance").trim() || "guidance",
    event: SHARED_EVENTS.workflowInvariantViolation,
    detail: { violations },
  });
  return true;
}
