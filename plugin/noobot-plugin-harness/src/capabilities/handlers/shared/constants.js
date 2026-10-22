/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { I18N_TEXT as HARNESS_I18N_TEXT, LOCALE as HARNESS_LOCALE } from "../../../i18n.js";

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: WORKFLOW_PARAMS.guidance.failureThreshold.consecutive,
  ACCUMULATED: WORKFLOW_PARAMS.guidance.failureThreshold.accumulated,
});

export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD =
  WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;
export const LLM_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW:
    WORKFLOW_PARAMS.guidance.summary.overflowPolicy.forceAcceptanceWhenStillOverflow,
});

export const LOCALE = HARNESS_LOCALE;

export const ACCEPTANCE_MODE = Object.freeze({
  ACTIVE: "active",
  FORCED: "forced",
});

export const GUIDANCE_REASON = Object.freeze({
  CONSECUTIVE_FAILURES: "consecutive_failures",
  ACCUMULATED_FAILURES: "accumulated_failures",
});

export const TOOL_NAME_SET = Object.freeze({
  CALL_SERVICE: "call_service",
  MULTIMODAL_PARSE: "multimodal_parse",
});

export const CAPABILITY_DOMAIN = Object.freeze({
  PLANNING: "planning",
  GUIDANCE: "guidance",
  ACCEPTANCE: "acceptance",
  REVIEW: "review",
});

export const PROMPT_ENVELOPE = Object.freeze({
  VERSION: "v1",
  TYPE: "structured_v1",
});

export const HARNESS_INJECTION_MESSAGE_ROLE = "system";
export const HARNESS_INJECTED_MESSAGE_BY_VALUE = "harness-plugin";

export const I18N_TEXT = HARNESS_I18N_TEXT;

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  ...WORKFLOW_PARAMS.acceptance.guards.blockedAgentToolNames,
]);

export const GUIDANCE_WEB_TOOL_NAMES = [...WORKFLOW_PARAMS.guidance.web.toolNames];
export const TASK_ACCEPTANCE_TOOL_NAME = WORKFLOW_PARAMS.acceptance.tools.taskAcceptanceToolName;
export const PLAN_REFINEMENT_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.planRefinementToolName;

export const HARNESS_BUCKET_VERSION = 10;

export const DEFAULT_HARNESS_COUNTERS = Object.freeze({
  llmTurns: 0,
  lastPlanningCounterTurn: 0,
  analysisTurns: 0,
  planUpdateTurns: 0,
  phaseAcceptanceTurns: 0,
  summaryRounds: 0,
  hookTurns: 0,
  consecutiveToolFailures: 0,
  totalToolFailures: 0,
  planRevisionAttempts: 0,
  planRefinementAttempts: 0,
  planUpdateAttempts: 0,
});

export const DEFAULT_HARNESS_FLAGS = Object.freeze({
  planningPromptInjected: false,
  planningCaptured: false,
  planningSeparateModelInFlight: false,
  agentTurnEnded: false,
  acceptanceRequested: false,
  acceptanceReviewing: false,
  planRefinementRequested: false,
  checklistArtifactsAttached: false,
  planningForceToolTemporarilyEnabled: false,
  planningForceToolOriginalSet: false,
  planningForceToolOriginal: false,
  guidanceSummaryMarkPending: false,
  phaseAcceptanceTriggeredThisTurn: false,
  summaryByCharsPrompted: false,
  overflowForceAcceptancePending: false,
  planUpdateCapturePending: false,
  phaseAcceptanceCapturePending: false,
  acceptanceSemanticValidationCapturePending: false,
});

export const DEFAULT_HARNESS_SIGNALS = Object.freeze({
  parsedAttachment: false,
  successfulToolCount: 0,
  activeDialogProcessId: "",
});

export const DEFAULT_HARNESS_PENDING = Object.freeze({
  guidance: null,
  analysis: false,
  summary: false,
  summaryCheckpointMessageKeys: null,
  planRevision: false,
  planRevisionContext: null,
  planRefinement: false,
  planRefinementContext: null,
  phaseAcceptance: false,
  acceptanceSemanticValidation: null,
});
