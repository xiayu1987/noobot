/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const HARNESS_STRATEGIES = Object.freeze({
  SUMMARY: "harness_summary",
  PLANNING: "harness_planning",
  ACCEPTANCE: "harness_acceptance",
});

export const HARNESS_SCENARIO = Object.freeze({
  name: "harness",
  strategies: Object.freeze(Object.values(HARNESS_STRATEGIES)),
  categories: Object.freeze({
    summary: Object.freeze(["summary_detail"]),
    planning: Object.freeze([
      "planning",
      "planning_followup",
      "planning_revision",
      "planning_revision_followup",
      "planning_refinement",
      "planning_refinement_followup",
      "next_phase_plan",
      "next_phase_plan_followup",
      "next_phase_plan_refinement",
      "next_phase_plan_refinement_followup",
    ]),
    acceptance: Object.freeze([
      "acceptance_plan",
      "acceptance_report",
      "acceptance_checklist",
      "phase_acceptance",
      "phase_acceptance_before_final",
      "acceptance_semantic_validation",
    ]),
  }),
});
