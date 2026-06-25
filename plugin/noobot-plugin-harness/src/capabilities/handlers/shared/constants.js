/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  DEFAULT_SUBTASK_OWNERS as HARNESS_DEFAULT_SUBTASK_OWNERS,
  DEFAULT_TASK_OWNER as HARNESS_DEFAULT_TASK_OWNER,
  DEFAULT_TASK_TEMPLATE as HARNESS_DEFAULT_TASK_TEMPLATE,
  I18N_TEXT as HARNESS_I18N_TEXT,
  LOCALE as HARNESS_LOCALE,
  PROMPT_JSON_FORMAT_EXAMPLES as HARNESS_PROMPT_JSON_FORMAT_EXAMPLES,
} from "../../../i18n.js";

export const FAILURE_THRESHOLD = Object.freeze({
  CONSECUTIVE: WORKFLOW_PARAMS.guidance.failureThreshold.consecutive,
  ACCUMULATED: WORKFLOW_PARAMS.guidance.failureThreshold.accumulated,
});

export const LLM_SUMMARY_THRESHOLD = WORKFLOW_PARAMS.guidance.summary.turnsThreshold;
export const LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD =
  WORKFLOW_PARAMS.guidance.summary.messageCharsThreshold;
export const LLM_SUMMARY_OVERFLOW_POLICY = Object.freeze({
  ENABLE_PRUNE_AFTER_SUMMARY: WORKFLOW_PARAMS.guidance.summary.overflowPolicy.enablePruneAfterSummary,
  PRUNE_TRIGGER_AFTER_CHAR_SUMMARY_ROUNDS:
    WORKFLOW_PARAMS.guidance.summary.overflowPolicy.pruneTriggerAfterCharSummaryRounds,
  FORCE_ACCEPTANCE_WHEN_STILL_OVERFLOW:
    WORKFLOW_PARAMS.guidance.summary.overflowPolicy.forceAcceptanceWhenStillOverflow,
});

export const LOCALE = HARNESS_LOCALE;

export const DEFAULT_TASK_OWNER = HARNESS_DEFAULT_TASK_OWNER;

export const DEFAULT_SUBTASK_OWNERS = HARNESS_DEFAULT_SUBTASK_OWNERS;

export const DEFAULT_TASK_TEMPLATE = HARNESS_DEFAULT_TASK_TEMPLATE;

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
  WEB_TO_DATA: "web_to_data",
  MEDIA_TO_DATA: "media_to_data",
  DOC_TO_DATA: "doc_to_data",
  PROCESS_CONTENT_TASK: "process_content_task",
  DELEGATE_TASK_ASYNC: "delegate_task_async",
  PLAN_MULTI_TASK_COLLABORATION: "plan_multi_task_collaboration",
  WAIT_ASYNC_TASK_RESULT: "wait_async_task_result",
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

// Harness-to-main-flow injections default to system role and are tagged so the
// agent can persist/display them separately from real turns. Summary request
// injections are the only user-role exception because they intentionally ask
// the main agent to produce the summary response.
export const HARNESS_INJECTION_MESSAGE_ROLE = "system";
export const HARNESS_INJECTED_MESSAGE_FLAG_FIELD = "injectedMessage";
export const HARNESS_INJECTED_MESSAGE_FLAG_VALUE = true;
export const HARNESS_INJECTED_MESSAGE_BY_FIELD = "injectedBy";
export const HARNESS_INJECTED_MESSAGE_BY_VALUE = "harness-plugin";
export const HARNESS_INJECTED_MESSAGE_TYPE_FIELD = "injectedMessageType";
export const HARNESS_PROMPT_INJECTION_ID_FIELD = "promptInjectionId";
export const HARNESS_MESSAGE_BLOCK_POLICY_FIELD = "messageBlockPolicy";
export const HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_FIELD = "scope";
export const HARNESS_MESSAGE_BLOCK_POLICY_SCOPE_SYSTEM = "system";
export const HARNESS_MESSAGE_BLOCK_POLICY_PRESERVE_FIELD = "preserve";
export const HARNESS_MESSAGE_BLOCK_POLICY_SLOT_FIELD = "slot";

export const PROMPT_JSON_FORMAT_EXAMPLES = HARNESS_PROMPT_JSON_FORMAT_EXAMPLES;

export const I18N_TEXT = HARNESS_I18N_TEXT;

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  ...WORKFLOW_PARAMS.acceptance.guards.blockedAgentToolNames,
]);

export const GUIDANCE_WEB_SERVICE_NAME = WORKFLOW_PARAMS.guidance.web.serviceName;
export const GUIDANCE_WEB_TOOL_NAMES = [...WORKFLOW_PARAMS.guidance.web.toolNames];
export const TASK_ACCEPTANCE_TOOL_NAME = WORKFLOW_PARAMS.acceptance.tools.taskAcceptanceToolName;
export const PLAN_REFINEMENT_TOOL_NAME = WORKFLOW_PARAMS.planning.tools.planRefinementToolName;

export const HARNESS_BUCKET_VERSION = 4;

export const DEFAULT_HARNESS_COUNTERS = Object.freeze({
  llmTurns: 0,
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
  checklistArtifactsAttached: false,
  planningForceToolTemporarilyEnabled: false,
  planningForceToolOriginalSet: false,
  planningForceToolOriginal: false,
  guidanceSummaryMarkPending: false,
  phaseAcceptanceTriggeredThisTurn: false,
  summaryByCharsPrompted: false,
  overflowForceAcceptancePending: false,
  mainFlowFinalNoToolsPending: false,
  planUpdateCapturePending: false,
  phaseAcceptanceCapturePending: false,
  acceptanceSemanticValidationCapturePending: false,
  acceptanceReportAppendedToFinalOutput: false,
});

export const DEFAULT_HARNESS_SIGNALS = Object.freeze({
  parsedAttachment: false,
  subtaskStarted: false,
  subtaskWaited: false,
  successfulToolCount: 0,
  activeDialogProcessId: "",
});

export const DEFAULT_HARNESS_PENDING = Object.freeze({
  guidance: null,
  analysis: false,
  summary: false,
  summaryCheckpointMessageCount: null,
  summaryCheckpointMessageIds: null,
  planRevision: false,
  planRevisionContext: null,
  planRefinement: false,
  planRefinementContext: null,
  phaseAcceptance: false,
  acceptanceSemanticValidation: null,
});
