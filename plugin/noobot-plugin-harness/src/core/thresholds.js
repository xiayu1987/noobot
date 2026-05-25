/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: 3,
  ACCUMULATED: 10,
});

export const SUMMARY_POLICY = Object.freeze({
  TURNS_THRESHOLD: 15,
  MESSAGE_CHARS_THRESHOLD: 150000,
  OVERFLOW_POLICY: Object.freeze({
    ENABLE_PRUNE_AFTER_SUMMARY: true,
    PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS: 1,
    FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW: true,
  }),
});

export const LLM_SUMMARY_THRESHOLD = SUMMARY_POLICY.TURNS_THRESHOLD;
export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = SUMMARY_POLICY.MESSAGE_CHARS_THRESHOLD;
export const LLM_SUMMARY_OVERFLOW_POLICY = SUMMARY_POLICY.OVERFLOW_POLICY;

export const PLAN_UPDATE_POLICY = Object.freeze({
  MAX_ATTEMPTS: 5,
});

// Legacy exports for backward compatibility.
export const MAX_PLAN_UPDATE_ATTEMPTS = PLAN_UPDATE_POLICY.MAX_ATTEMPTS;
// Backward compatibility alias (revision + refinement now share one unified threshold).
export const MAX_PLAN_REVISION_ATTEMPTS = MAX_PLAN_UPDATE_ATTEMPTS;

// Retry at most once after the first failed planning capture.
export const MAX_PLANNING_CAPTURE_ATTEMPTS = 2;

export const PLANNING_RAW_OUTPUT_LIMIT = 20;
export const PLANNING_SUMMARY_MAX_ITEMS = 8;
export const PLANNING_COMPACT_TEXT_MAX_CHARS = 500;
export const PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS = 300;
export const PLANNING_CONTEXT_GOAL_MAX_CHARS = 800;
