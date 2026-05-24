/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  FAILURE_THRESHOLD,
  LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD,
  LLM_SUMMARY_THRESHOLD,
} from "../../../core/thresholds.js";

export { FAILURE_THRESHOLD, LLM_SUMMARY_MESSAGE_CHARS_THRESHOLD, LLM_SUMMARY_THRESHOLD };

export const LOCALE = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
});

export const DEFAULT_TASK_OWNER = Object.freeze({
  [LOCALE.ZH_CN]: "primary_task_owner",
  [LOCALE.EN_US]: "primary_task_owner",
});

export const DEFAULT_SUBTASK_OWNERS = Object.freeze({
  [LOCALE.ZH_CN]: ["subtask_owner_alpha", "subtask_owner_beta"],
  [LOCALE.EN_US]: ["subtask_owner_alpha", "subtask_owner_beta"],
});

export const DEFAULT_TASK_TEMPLATE = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    PARSE_ATTACHMENT: "解析附件",
    EXECUTE_CORE: "执行核心任务",
    START_SUBTASK: "开启子任务",
    WAIT_SUBTASK_RESULT: "等待子任务结果",
  }),
  [LOCALE.EN_US]: Object.freeze({
    PARSE_ATTACHMENT: "Parse attachments",
    EXECUTE_CORE: "Execute core task",
    START_SUBTASK: "Start subtasks",
    WAIT_SUBTASK_RESULT: "Wait for subtask results",
  }),
});

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

// All harness-to-main-flow injections are normalized to user role and
// tagged so the agent can persist/display them separately from real user turns.
export const HARNESS_INJECTION_MESSAGE_ROLE = "user";
export const HARNESS_INJECTED_MESSAGE_FLAG_FIELD = "injectedMessage";
export const HARNESS_INJECTED_MESSAGE_FLAG_VALUE = true;
export const HARNESS_INJECTED_MESSAGE_BY_FIELD = "injectedBy";
export const HARNESS_INJECTED_MESSAGE_BY_VALUE = "harness-plugin";

export const PROMPT_JSON_FORMAT_EXAMPLES = Object.freeze({
  planning_main:
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  planning_revision:
    '{"totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"taskChecklist":[{"index":1,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  planning_refinement:
    '{"stage":"refinement","totalGoal":"...","taskOwner":"...","nextPhase":{"objective":"...","checklistIndexes":[1]},"refinementChecklist":[{"index":101,"mainStepIndex":1,"isMainStep":false,"task":"...","owner":"...","subOwners":[],"input":"...","output":"...","files":{"create":[],"modify":[],"delete":[]}}]}',
  acceptance_semantic_validation:
    '{"status":"pass|warn|fail","consistent":true,"missingItems":[],"unsupportedClaims":[],"checklistCoverage":[{"index":1,"task":"...","covered":true,"evidence":"...","risk":"low"}],"suggestions":[]}',
});

export const I18N_TEXT = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    taskAcceptanceToolDescription:
      "请求任务验收：按 harness 插件任务清单输出验收报告；mode=active(主动) 或 forced(强行)。",
    taskAcceptanceModeDescription: "验收模式：active(主动) 或 forced(强行)。",
    jsonOnlyOutputRequirement: "仅输出 JSON。",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningToolContextMarker: "<!-- harness-planning-tools -->",
    planningOriginalUserInputMarker: "<!-- harness-planning-user-input -->",
    planningOriginalUserInputHeader: "原始用户消息：",
    planningOriginalUserInputFallback: "（未获取到原始用户消息）",
    planningPromptBody:
      "基于完整上下文和全部工具生成完整计划。\\n输出后继续执行，不要结束。\\n工具范围用 *；后续修订也必须输出完整计划。",
    planningPromptFormatExample: "格式：{example}",
    planningContextSummaryHeader: "规划输入上下文摘要（精简）如下，必须完整参考：",
    planningSeparateModelEmptyRelay: "无",
    planningJsonRepairInstruction: "请把以下文本修复为严格 JSON，只输出 JSON。",
    planningJsonRepairOutputConstraint: "输出只能是 JSON 对象或数组。",
    planningJsonRepairStructureConstraint:
      "修复后的 JSON 需为规划清单结构（包含 totalGoal、taskOwner、nextPhase、taskChecklist）。",
    planningJsonRepairFormatExample: "待修复 JSON：{example}",
    planningJsonRepairFallbackInstruction: "如果无法修复为清单 JSON，请输出 {}。",
    planningPromptToolsHeader: "可用工具（name/description），规划必须参考：",
    planRefinementToolDescription: "在总计划完成后触发计划细化流程。",
    planRefinementToolSummaryDescription: "可选的小结文本，会作为计划细化上下文。",
    planRefinementNotReadyReason: "总计划流程尚未完成",
    planRefinementConvergedReason: "未找到可细化的主步骤",
    planRefinementFailedReason: "插件侧细化失败",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: "请先对已完成内容进行小结（注意是小结，不是总结），小结完请继续任务，输出已完成项，及问题说明。",
    planningRefinementMarker: "<!-- harness-planning-refinement -->",
    planningRefinementPromptBody:
      "基于当前状态和阶段小结生成细化的增量计划。\\n必须使用 refinement 专用结构：stage=refinement，输出 refinementChecklist（禁止输出 taskChecklist）；每项必须包含 mainStepIndex 且 isMainStep=false，并且必须可映射到 targetMainSteps。\\n格式：{example}",
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "基于当前状态和阶段小结修订计划，并给出 nextPhase。\\n格式：{example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody: "工具失败达到阈值({reason})，请分析工具失败原因，并且给予修复建议。",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody: "基于最新计划和验收报告做语义一致性校验。",
    acceptanceSemanticValidationFormatExample: "格式：{example}",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[来自harness外部模型输出/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
  [LOCALE.EN_US]: Object.freeze({
    taskAcceptanceToolDescription:
      "Request task acceptance: validate completion against the harness checklist; mode=active or forced.",
    taskAcceptanceModeDescription: "Acceptance mode: active or forced.",
    jsonOnlyOutputRequirement: "Output JSON only.",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningToolContextMarker: "<!-- harness-planning-tools -->",
    planningOriginalUserInputMarker: "<!-- harness-planning-user-input -->",
    planningOriginalUserInputHeader: "Original user message:",
    planningOriginalUserInputFallback: "(original user message unavailable)",
    planningPromptBody:
      "Generate a complete plan from full context and all tools.\\nContinue after output and do not end.\\nUse * for tool scope; revisions must also output the full plan.",
    planningPromptFormatExample: "Format: {example}",
    planningContextSummaryHeader: "Planning context summary (compact). Must be fully considered:",
    planningSeparateModelEmptyRelay: "None",
    planningJsonRepairInstruction: "Repair the following text into strict JSON only.",
    planningJsonRepairOutputConstraint: "Output only JSON object or array.",
    planningJsonRepairStructureConstraint:
      "The repaired JSON should be a planning checklist structure (including totalGoal, taskOwner, nextPhase, taskChecklist).",
    planningJsonRepairFormatExample: "JSON to repair: {example}",
    planningJsonRepairFallbackInstruction: "If content cannot be repaired into checklist JSON, output {}.",
    planningPromptToolsHeader: "Available tools (name/description), must be referenced:",
    planRefinementToolDescription: "Trigger planning refinement flow after main plan is ready.",
    planRefinementToolSummaryDescription: "Optional summary text used as refinement context.",
    planRefinementNotReadyReason: "main planning flow is not completed yet",
    planRefinementConvergedReason: "no refinable main step found",
    planRefinementFailedReason: "plugin-side refinement failed",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: "Please provide a guidance summary of completed items and issues based on unsummarized messages, then continue with the task.",
    planningRefinementMarker: "<!-- harness-planning-refinement -->",
    planningRefinementPromptBody:
      "Generate a refined incremental plan from current state and phase summary.\\nUse a refinement-only schema: stage=refinement and refinementChecklist (taskChecklist is forbidden). Every item must include mainStepIndex and isMainStep=false, and must map to targetMainSteps.\\nFormat: {example}",
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "Revise the plan from current state and phase summary and include nextPhase.\\nFormat: {example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody:
      "Guidance triggered by tool failure threshold ({reason}). Please analyze the causes of tool failures and provide suggestions for fixes.",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody:
      "Validate semantic consistency from latest plan and acceptance report.",
    acceptanceSemanticValidationFormatExample: "Format: {example}",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[Relay from harness external model/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
});

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION,
  "task_summary",
]);

export const GUIDANCE_WEB_SERVICE_NAME = "web_search_service";
export const GUIDANCE_WEB_TOOL_NAMES = [TOOL_NAME_SET.CALL_SERVICE];
export const TASK_ACCEPTANCE_TOOL_NAME = "request_task_acceptance";
export const PLAN_REFINEMENT_TOOL_NAME = "request_plan_refinement";

export const HARNESS_BUCKET_VERSION = 2;

export const DEFAULT_HARNESS_COUNTERS = Object.freeze({
  llmTurns: 0,
  hookTurns: 0,
  consecutiveToolFailures: 0,
  totalToolFailures: 0,
  planRevisionAttempts: 0,
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
  planRevisionCapturePending: false,
  acceptanceSemanticValidationCapturePending: false,
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
  summary: false,
  planRevision: false,
  acceptanceSemanticValidation: null,
});
