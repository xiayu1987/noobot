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

  if (state.pending.planRevision === true) {
    const revisionContext =
      state.pending.planRevisionContext && typeof state.pending.planRevisionContext === "object"
        ? state.pending.planRevisionContext
        : {};
    const normalizedRevisionContext = {
      summaryText: String(revisionContext.summaryText || "").trim(),
      targetMainStepIndexes: Array.isArray(revisionContext.targetMainStepIndexes)
        ? revisionContext.targetMainStepIndexes
        : [],
    };
    if (state.pending.planRevisionContext !== normalizedRevisionContext) {
      state.pending.planRevisionContext = normalizedRevisionContext;
      changed = true;
      violations.push("pending.planRevisionContext_normalized");
    }
  } else if (state.pending.planRevisionContext) {
    state.pending.planRevisionContext = null;
    changed = true;
    violations.push("pending.planRevisionContext_cleared_without_pending");
  }

  if (state.pending.planRefinement === true) {
    const refinementContext =
      state.pending.planRefinementContext && typeof state.pending.planRefinementContext === "object"
        ? state.pending.planRefinementContext
        : {};
    const normalizedRefinementContext = {
      summaryText: String(refinementContext.summaryText || "").trim(),
      targetMainStepIndexes: Array.isArray(refinementContext.targetMainStepIndexes)
        ? refinementContext.targetMainStepIndexes
        : [],
    };
    if (state.pending.planRefinementContext !== normalizedRefinementContext) {
      state.pending.planRefinementContext = normalizedRefinementContext;
      changed = true;
      violations.push("pending.planRefinementContext_normalized");
    }
  } else if (state.pending.planRefinementContext) {
    state.pending.planRefinementContext = null;
    changed = true;
    violations.push("pending.planRefinementContext_cleared_without_pending");
  }

  if ("planUpdate" in state.pending) {
    delete state.pending.planUpdate;
    changed = true;
    violations.push("pending.planUpdate_removed");
  }
  if ("planUpdateStage" in state.pending) {
    delete state.pending.planUpdateStage;
    changed = true;
    violations.push("pending.planUpdateStage_removed");
  }
  if ("planUpdateContext" in state.pending) {
    delete state.pending.planUpdateContext;
    changed = true;
    violations.push("pending.planUpdateContext_removed");
  }

  if ("planRevisionStage" in state.pending) {
    delete state.pending.planRevisionStage;
    changed = true;
    violations.push("pending.planRevisionStage_removed");
  }
  if ("planRevisionTargetMainStepIndexes" in state.pending) {
    delete state.pending.planRevisionTargetMainStepIndexes;
    changed = true;
    violations.push("pending.planRevisionTargetMainStepIndexes_removed");
  }
  if ("summaryText" in state.pending) {
    delete state.pending.summaryText;
    changed = true;
    violations.push("pending.summaryText_removed");
  }
  if ("planRevisionCapturePending" in state.flags) {
    delete state.flags.planRevisionCapturePending;
    changed = true;
    violations.push("flags.planRevisionCapturePending_removed");
  }
  if ("planRevisionCaptureStage" in state.flags) {
    delete state.flags.planRevisionCaptureStage;
    changed = true;
    violations.push("flags.planRevisionCaptureStage_removed");
  }
  if ("planRevisionCaptureSummaryText" in state.flags) {
    delete state.flags.planRevisionCaptureSummaryText;
    changed = true;
    violations.push("flags.planRevisionCaptureSummaryText_removed");
  }
  if ("planRevisionCaptureTargetMainStepIndexes" in state.flags) {
    delete state.flags.planRevisionCaptureTargetMainStepIndexes;
    changed = true;
    violations.push("flags.planRevisionCaptureTargetMainStepIndexes_removed");
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
