/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  createGuidanceHandler,
  createPlanningHandler,
} from "../helpers/context-aware-handler-fixtures.js";
import { runPlanUpdateAfterSummary } from "../../src/capabilities/handlers/guidance/model-runner.js";
import { WORKFLOW_PARAMS } from "../../src/core/workflow-params.js";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { TURN_THRESHOLDS } from "@noobot/shared/turn-thresholds";
export { WORKFLOW_PARAMS };

const MODE_THRESHOLDS = TURN_THRESHOLDS.harness.modeThresholds;

export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD =
  LENGTH_THRESHOLDS.context.harnessSummaryMessageChars;
export const MAX_PLAN_UPDATE_ATTEMPTS =
  TURN_THRESHOLDS.harness.planning.planUpdateRevisionMaxAttempts;
export const FULL_SUMMARY_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.full.summaryTurns;
export const FULL_ANALYSIS_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.full.analysisTurns;
export const FULL_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.full.planUpdateTriggerTurns;
export const FULL_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  MODE_THRESHOLDS.full.phaseAcceptanceTriggerTurns;
export const PROGRAMMING_SUMMARY_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.programming.summaryTurns;
export const PROGRAMMING_ANALYSIS_TRIGGER_TURNS_THRESHOLD =
  MODE_THRESHOLDS.programming.analysisTurns;
export const PROGRAMMING_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD =
  MODE_THRESHOLDS.programming.planUpdateTriggerTurns;
export const PROGRAMMING_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  MODE_THRESHOLDS.programming.phaseAcceptanceTriggerTurns;
export const TEXT_SUMMARY_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.text.summaryTurns;
export const TEXT_ANALYSIS_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.text.analysisTurns;
export const TEXT_PLAN_UPDATE_TRIGGER_TURNS_THRESHOLD = MODE_THRESHOLDS.text.planUpdateTriggerTurns;
export const TEXT_PHASE_ACCEPTANCE_TRIGGER_TURNS_THRESHOLD =
  MODE_THRESHOLDS.text.phaseAcceptanceTriggerTurns;

export function createAgentContext({ planText = "1. 主任务\n", pending = {}, counters = {} } = {}) {
  return {
    bindings: {
      extensions: {
        harness: {
          planText,
          state: {
            flags: { planningCaptured: true, acceptanceRequested: false },
            counters: {
              llmTurns: 0,
              consecutiveToolFailures: 0,
              totalToolFailures: 0,
              ...counters,
            },
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
    },
  };
}

export function createPlanningAgentContext({ counters = {}, scenario = "full" } = {}) {
  return {
    bindings: {
      runtime: {
        runConfig: { scenario },
      },
      tools: [{ name: "read_file", invoke: async () => ({ ok: true }) }],
      extensions: {
        harness: {
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
          state: {
            counters: { llmTurns: 0, ...counters },
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
    },
  };
}

export { createGuidanceHandler, createPlanningHandler, runPlanUpdateAfterSummary };
