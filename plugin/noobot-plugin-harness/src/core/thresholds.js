/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: 3,
  ACCUMULATED: 10,
});

export const LLM_SUMMARY_THRESHOLD = 15;

export const MAX_PLANNING_CAPTURE_ATTEMPTS = 3;

export const PLANNING_RAW_OUTPUT_LIMIT = 20;
export const PLANNING_SUMMARY_MAX_ITEMS = 8;
export const PLANNING_COMPACT_TEXT_MAX_CHARS = 500;
export const PLANNING_RAW_OUTPUT_PREVIEW_MAX_CHARS = 300;
export const PLANNING_CONTEXT_GOAL_MAX_CHARS = 800;

export const MAX_PLAN_REVISION_ATTEMPTS = 5;
