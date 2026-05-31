/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { appendCapabilityLog } from "../attachment-log-utils.js";

const SHARED_EVENTS = WORKFLOW_PARAMS.logging.events.shared;
const GUIDANCE_DECISION = WORKFLOW_PARAMS.guidance.decisions;

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

  if (state.pending.planUpdate === false) {
    if (state.pending.planRevision === true || state.pending.planRevisionContext) {
      state.pending.planRevision = false;
      state.pending.planRevisionContext = null;
      changed = true;
      violations.push("pending.planRevision_cleared_by_planUpdate_false");
    }
    if (state.pending.planRefinement === true || state.pending.planRefinementContext) {
      state.pending.planRefinement = false;
      state.pending.planRefinementContext = null;
      changed = true;
      violations.push("pending.planRefinement_cleared_by_planUpdate_false");
    }
    if (String(state.pending.planUpdateStage || "").trim()) {
      state.pending.planUpdateStage = "";
      changed = true;
      violations.push("pending.planUpdateStage_cleared_by_planUpdate_false");
    }
    if (state.pending.planUpdateContext) {
      state.pending.planUpdateContext = null;
      changed = true;
      violations.push("pending.planUpdateContext_cleared_by_planUpdate_false");
    }
  } else if (
    state.pending.planUpdate !== true &&
    (state.pending.planRevision === true || state.pending.planRefinement === true)
  ) {
    state.pending.planUpdate = true;
    changed = true;
    violations.push("pending.plan_update_stage_migrated_to_planUpdate");
  }

  if (state.pending.planUpdate === true) {
    const stageRaw = String(state.pending.planUpdateStage || "").trim().toLowerCase();
    const stageNormalized =
      state.pending.planRevision === true
        ? GUIDANCE_DECISION.stage.revision
        : state.pending.planRefinement === true
          ? GUIDANCE_DECISION.stage.refinement
          : stageRaw === GUIDANCE_DECISION.stage.refinement
            ? GUIDANCE_DECISION.stage.refinement
            : GUIDANCE_DECISION.stage.revision;
    if (stageRaw !== stageNormalized) {
      state.pending.planUpdateStage = stageNormalized;
      changed = true;
      violations.push("pending.planUpdateStage_missing_or_invalid");
    }
    if (!state.pending.planUpdateContext || typeof state.pending.planUpdateContext !== "object") {
      state.pending.planUpdateContext = { summaryText: "", targetMainStepIndexes: [] };
      changed = true;
      violations.push("pending.planUpdateContext_missing");
    }
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
