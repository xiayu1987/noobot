/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { WORKFLOW_PARAMS } from "./workflow-params.js";

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: WORKFLOW_PARAMS.guidance.failureThreshold.consecutive,
  ACCUMULATED: WORKFLOW_PARAMS.guidance.failureThreshold.accumulated,
});

export const SUMMARY_POLICY = Object.freeze({
  TURNS_THRESHOLD: WORKFLOW_PARAMS.planning.summary.turnsThreshold,
  MESSAGE_CHARS_THRESHOLD: WORKFLOW_PARAMS.planning.summary.messageCharsThreshold,
  OVERFLOW_POLICY: Object.freeze({
    ENABLE_PRUNE_AFTER_SUMMARY: WORKFLOW_PARAMS.planning.summary.overflowPolicy.enablePruneAfterSummary,
    PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS:
      WORKFLOW_PARAMS.planning.summary.overflowPolicy.pruneTriggerAfterCharSummaryRounds,
    FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW:
      WORKFLOW_PARAMS.planning.summary.overflowPolicy.forceAcceptanceWhenStillOverflow,
  }),
});

export const LLM_SUMMARY_THRESHOLD = SUMMARY_POLICY.TURNS_THRESHOLD;
export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = SUMMARY_POLICY.MESSAGE_CHARS_THRESHOLD;
export const LLM_SUMMARY_OVERFLOW_POLICY = SUMMARY_POLICY.OVERFLOW_POLICY;

export const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS: WORKFLOW_PARAMS.planning.planUpdate.maxAttempts,
  TRIGGER_TURNS_THRESHOLD: WORKFLOW_PARAMS.planning.planUpdate.triggerTurnsThreshold,
});

export const ACCEPTANCE_POLICY = Object.freeze({
  PHASE_TRIGGER_TURNS_THRESHOLD: WORKFLOW_PARAMS.acceptance.phase.triggerTurnsThreshold,
});

// Legacy exports for backward compatibility.
export const MAX_PLAN_UPDATE_ATTEMPTS = PLAN_UPDATE_POLICY.MAX_ATTEMPTS;
export const PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD = PLAN_UPDATE_POLICY.TRIGGER_TURNS_THRESHOLD;
export const PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD = ACCEPTANCE_POLICY.PHASE_TRIGGER_TURNS_THRESHOLD;
// Backward compatibility alias (revision + refinement now share one unified threshold).
export const MAX_PLAN_REVISION_ATTEMPTS = MAX_PLAN_UPDATE_ATTEMPTS;

// Retry at most once after the first failed planning capture.
export const MAX_PLANNING_CAPTURE_ATTEMPTS = WORKFLOW_PARAMS.planning.capture.maxAttempts;

export const PLANNING_RAW_OUTPUT_LIMIT = WORKFLOW_PARAMS.planning.capture.rawOutputLimit;
export const PLANNING_SUMMARY_MAX_ITEMS = WORKFLOW_PARAMS.planning.capture.summaryMaxItems;
export const PLANNING_COMPACT_TEXT_MAX_CHARS = WORKFLOW_PARAMS.planning.capture.compactTextMaxChars;
export const PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS =
  WORKFLOW_PARAMS.planning.capture.rawOutputPreviewMaxChars;
export const PLANNING_CONTEXT_GOAL_MAX_CHARS = WORKFLOW_PARAMS.planning.capture.contextGoalMaxChars;
