/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createGuidanceHandler } from "../../src/capabilities/handlers/guidance.js";
import { createPlanningHandler } from "../../src/capabilities/handlers/planning.js";
import { canAttemptPlanRevision } from "../../src/capabilities/handlers/planning/revision-engine.js";
import { runPlanUpdateAfterSummary } from "../../src/capabilities/handlers/guidance/model-runner.js";
import { WORKFLOW_PARAMS } from "../../src/core/workflow-params.js";
export { WORKFLOW_PARAMS };

export const LLM_SUMMARY_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.turnsThreshold;
export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;
export const MAX_PLAN_UPDATE_ATTEMPTS = WORKFLOW_PARAMS.planning.planUpdate.revisionMaxAttempts;
export const FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.guidance.summary.turnsThreshold;
export const FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.guidance.analysis.turnsThreshold;
export const PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.guidance.summary.turnsThreshold;
export const PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.guidance.analysis.turnsThreshold;
export const FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.planning.planUpdate.triggerTurnsThreshold;
export const PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.planning.planUpdate.triggerTurnsThreshold;
export const FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.full.acceptance.phase.triggerTurnsThreshold;
export const PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.programming.acceptance.phase.triggerTurnsThreshold;
export const TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.guidance.summary.turnsThreshold;
export const TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.guidance.analysis.turnsThreshold;
export const TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.planning.planUpdate.triggerTurnsThreshold;
export const TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  WORKFLOW_PARAMS.modeThresholds.text.acceptance.phase.triggerTurnsThreshold;

export function createAgentContext({
  planText = "1. 主任务\n",
  pending = {},
  counters = {},
} = {}) {
  return {
    payload: {
      messages: { system: [], history: [] },
      harness: {
        planText,
        state: {
          flags: { planningCaptured: true, acceptanceRequested: false },
          counters: { llmTurns: 0, consecutiveToolFailures: 0, totalToolFailures: 0, ...counters },
          signals: { successfulToolCount: 1 },
          pending: {
            summary: false,
            guidance: null,
            planRevision: false,
            planRevisionContext: null,
            planRefinement: false,
            planRefinementContext: null,
            ...pending,
          },
        },
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
      },
    },
  };
}

export function createPlanningAgentContext({ counters = {}, scenario = "full" } = {}) {
  return {
    execution: {
      controllers: {
        runtime: {
          runConfig: { scenario },
        },
      },
    },
    payload: {
      messages: { system: [], history: [] },
      tools: { registry: [{ name: "read_file", invoke: async () => ({ ok: true }) }] },
      harness: {
        logs: { planning: [], guidance: [], acceptance: [], review: [] },
        state: {
          counters: { llmTurns: 0, planUpdateAttempts: 0, ...counters },
          pending: {
            summary: false,
            guidance: null,
            planRevision: false,
            planRevisionContext: null,
            planRefinement: false,
            planRefinementContext: null,
          },
        },
      },
    },
  };
}


export { createGuidanceHandler, createPlanningHandler, canAttemptPlanRevision, runPlanUpdateAfterSummary };
