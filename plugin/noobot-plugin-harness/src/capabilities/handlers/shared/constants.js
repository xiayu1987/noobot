/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { FAILURE_THRESHOLD, LLM_SUMMARY_THRESHOLD } from "../../../core/thresholds.js";

export { FAILURE_THRESHOLD, LLM_SUMMARY_THRESHOLD };

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

export const I18N_TEXT = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    taskAcceptanceToolDescription:
      "请求任务验收：按 harness 插件任务清单输出验收报告；mode=active(主动) 或 forced(强行)。",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningPromptBody:
      "基于完整上下文和全部工具生成完整计划：必须包含 totalGoal；每步必须包含 task、input、output、files(create/modify/delete)。\\n仅输出 JSON：{example}\\n输出后继续执行，不要结束。\\n工具范围用 *；后续修订也必须输出完整计划。",
    planningPromptToolsHeader: "可用工具（name/description），规划必须参考：",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: "只输出已完成项；最后一行必须为“小结完成”。",
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "基于当前状态和阶段小结修订计划。\\n仅输出完整计划 JSON，并给出 nextPhase。\\n格式：{example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody: "工具失败达到阈值({reason})，基于未小结消息给出下一步指引。",
    guidancePreferTools: "优先工具：{tools}。",
    guidanceWebService: "网页搜索使用 {service}（通过 {tool}）。",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody: "基于最新计划和验收报告做语义一致性校验；仅输出 JSON。",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[来自harness外部模型输出/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
  [LOCALE.EN_US]: Object.freeze({
    taskAcceptanceToolDescription:
      "Request task acceptance: validate completion against the harness checklist; mode=active or forced.",
    planningPromptMarker: "<!-- harness-planning-bootstrap -->",
    planningPromptBody:
      "Generate a complete plan from full context and all tools: include totalGoal; each step must include task/input/output/files(create/modify/delete).\\nJSON only: {example}\\nContinue after output; do not end.\\nUse * for tool scope; revisions must also output the full plan.",
    planningPromptToolsHeader: "Available tools (name/description), must be referenced:",
    guidanceSummaryMarker: "<!-- harness-guidance-summary -->",
    guidanceSummaryBody: 'Only output completed items; final line must be "Summary complete".',
    planningRevisionMarker: "<!-- harness-planning-revision -->",
    planningRevisionPromptBody:
      "Revise the plan from current state and phase summary.\\nOutput full plan JSON only and include nextPhase.\\nFormat: {example}",
    guidanceMarker: "<!-- harness-guidance -->",
    guidanceBody:
      "Tool failures reached threshold ({reason}); provide next-step guidance from unsummarized messages.",
    guidancePreferTools: "Preferred tools: {tools}.",
    guidanceWebService: "Use web search {service} (via {tool}).",
    acceptanceSemanticValidationMarker: "<!-- harness-acceptance-semantic-validation -->",
    acceptanceSemanticValidationBody:
      "Validate semantic consistency from latest plan and acceptance report; JSON only.",
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[Relay from harness external model/{purpose}]",
    reviewHeader: "[Harness-Review]",
  }),
});

export const BLOCKED_AGENT_TOOL_NAMES = new Set([
  TOOL_NAME_SET.PLAN_MULTI_TASK_COLLABORATION,
  "request_help",
  "task_summary",
]);

export const GUIDANCE_WEB_SERVICE_NAME = "web_search_service";
export const GUIDANCE_WEB_TOOL_NAMES = [TOOL_NAME_SET.CALL_SERVICE];
export const TASK_ACCEPTANCE_TOOL_NAME = "request_task_acceptance";

export const HARNESS_BUCKET_VERSION = 1;

export const DEFAULT_HARNESS_COUNTERS = Object.freeze({
  llmTurns: 0,
  hookTurns: 0,
  consecutiveToolFailures: 0,
  totalToolFailures: 0,
});

export const DEFAULT_HARNESS_FLAGS = Object.freeze({
  planningPromptInjected: false,
  planningCaptured: false,
  planningSeparateModelInFlight: false,
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
});

export const DEFAULT_HARNESS_PENDING = Object.freeze({
  guidance: null,
  summary: false,
  planRevision: false,
  acceptanceSemanticValidation: null,
});
