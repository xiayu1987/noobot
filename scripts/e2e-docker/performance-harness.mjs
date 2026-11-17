/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { DEFAULT_TURN_THRESHOLDS } from "../../shared/turn-thresholds.js";
import { PERF_HARNESS_MODELS } from "../mock-model-service/performance-contract.mjs";

export const HARNESS_THRESHOLD_FIELDS = Object.freeze({
  guidance_analysis_scheduled_by_turn_threshold: "analysisTurns",
  summary_scheduled_by_turn_threshold: "summaryTurns",
  planning_revision_scheduled_by_turn_threshold: "planUpdateTriggerTurns",
  phase_acceptance_scheduled_by_turn_threshold: "phaseAcceptanceTriggerTurns",
});
export const HARNESS_REQUIRED_EVENTS = Object.freeze([
  "planning_checklist_captured",
  "planning_checklist_revised_after_summary",
  "planning_checklist_refined_after_revision",
  "summary_generated_by_separate_model",
  "summary_messages_marked",
  "phase_acceptance_completed",
  "acceptance_semantic_validation_completed",
  "checklist_artifacts_attached",
  "review_report_generated",
]);
export const HARNESS_MAIN_RELAYS = Object.freeze([
  "planning",
  "planning_followup",
  "guidance",
  "summary",
  "planning_revision",
  "next_phase_plan",
  "next_phase_plan_followup",
  "planning_refinement",
  "next_phase_plan_refinement",
  "next_phase_plan_refinement_followup",
  "phase_acceptance",
]);

export function assertPerformanceHarness(harness) {
  assert.equal(harness?.run?.status, "success", "Harness run did not complete");
  for (const purpose of Object.keys(PERF_HARNESS_MODELS))
    assert.ok(harness.purposes.includes(purpose), `missing Harness capability: ${purpose}`);
  for (const purpose of HARNESS_MAIN_RELAYS)
    assert.ok(harness.mainRelays.includes(purpose), `missing consumed Harness relay: ${purpose}`);
  for (const name of HARNESS_REQUIRED_EVENTS)
    assert.ok(
      harness.events.some((event) => event.event === name),
      `missing Harness event: ${name}`,
    );
  const thresholds = DEFAULT_TURN_THRESHOLDS.harness.modeThresholds.full;
  for (const [name, field] of Object.entries(HARNESS_THRESHOLD_FIELDS)) {
    const events = harness.events.filter((event) => event.event === name);
    assert.ok(events.length > 0, `missing Harness threshold trigger: ${name}`);
    for (const { detail } of events) {
      assert.equal(detail.thresholdMode, "full", `wrong Harness mode: ${name}`);
      assert.equal(
        detail.thresholdSource,
        "fallback",
        `unexpected Harness threshold override: ${name}`,
      );
      assert.equal(detail.triggerTurns, thresholds[field], `wrong system threshold: ${name}`);
    }
  }
  for (const event of harness.events) {
    assert.ok(!event.detail?.errorCode && !event.detail?.error, `Harness failure: ${event.event}`);
    if (event.event === "capability_model_trace") {
      assert.equal(event.detail.modelAttempts.length, 1, "unexpected Harness retry");
      assert.equal(event.detail.modelAttempts[0].status, "completed", "Harness model failed");
    }
  }
}
