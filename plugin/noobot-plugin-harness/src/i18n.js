/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const LOCALE = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
});

export const HARNESS_I18N_KEYSET = Object.freeze({
  REVIEW: Object.freeze({
    HEADER: "reviewHeader",
  }),
  ACCEPTANCE_REPORT: Object.freeze({
    RAW_TITLE: "acceptanceRawTitle",
    RAW_FORCED_REASON_FIELD: "acceptanceRawForcedReasonField",
    RAW_PLAN_TEXT_FIELD: "acceptanceRawPlanTextField",
    RAW_CHECKLIST_HEADER: "acceptanceRawChecklistHeader",
    RAW_SUMMARY_FIELD: "acceptanceRawSummaryField",
    RAW_SEMANTIC_FIELD: "acceptanceRawSemanticField",
    RAW_MODEL_FIELD: "acceptanceRawModelField",
    RAW_SUMMARY_DETAIL_PATHS_FIELD: "acceptanceRawSummaryDetailPathsField",
    MODE_LABEL: "acceptanceModeLabel",
    FORCED_REASON_LABEL: "acceptanceForcedReasonLabel",
    ACCEPTED_AT_LABEL: "acceptanceAcceptedAtLabel",
    PLAN_TEXT_LABEL: "acceptancePlanTextLabel",
    CHECKLIST_LABEL: "acceptanceChecklistLabel",
    SUMMARY_LABEL: "acceptanceSummaryLabel",
    SEMANTIC_VALIDATION_LABEL: "acceptanceSemanticValidationLabel",
    MODEL_ACCEPTANCE_LABEL: "acceptanceModelAcceptanceLabel",
    SUMMARY_DETAIL_PATHS_LABEL: "acceptanceSummaryDetailPathsLabel",
    EMPTY_LINE: "acceptanceEmptyLine",
    DIGEST_TITLE: "acceptanceDigestTitle",
    DIGEST_MODE_LABEL: "acceptanceDigestModeLabel",
    DIGEST_ACCEPTED_AT_LABEL: "acceptanceDigestAcceptedAtLabel",
    DIGEST_PLAN_TEXT_LABEL: "acceptanceDigestPlanTextLabel",
    DIGEST_SUMMARY_LABEL: "acceptanceDigestSummaryLabel",
    DIGEST_SEMANTIC_VALIDATION_LABEL: "acceptanceDigestSemanticValidationLabel",
    DIGEST_SUMMARY_DETAIL_PATHS_LABEL: "acceptanceDigestSummaryDetailPathsLabel",
    DIGEST_NO_DETAIL_PATHS: "acceptanceDigestNoDetailPaths",
  }),
  ACCEPTANCE_FINAL_OUTPUT: Object.freeze({
    FORCED_HEADER: "forcedAcceptanceHeader",
    FORCED_REASON_REBUILT_ARTIFACTS: "acceptanceForcedReasonRebuiltArtifacts",
    CHECKLIST_ARTIFACTS_GENERATED_NOTICE: "acceptanceChecklistArtifactsGeneratedNotice",
    FORCED_REASON_OVERFLOW_FALLBACK: "acceptanceForcedReasonOverflowFallback",
    FORCED_REASON_NO_ACTIVE_REQUEST: "acceptanceForcedReasonNoActiveRequest",
  }),
  ACCEPTANCE_VALIDATION: Object.freeze({
    PHASE_FINAL_OUTPUT_FALLBACK: "phaseAcceptanceFinalOutputFallback",
  }),
  ACCEPTANCE_TOOL: Object.freeze({
    DESCRIPTION: "taskAcceptanceToolDescription",
    MODE_DESCRIPTION: "taskAcceptanceModeDescription",
    FORCED_REASON_OVERFLOW_IN_FLOW: "taskAcceptanceForcedReasonOverflowInFlow",
    FORCED_REASON_TOOL_REQUESTED: "taskAcceptanceForcedReasonToolRequested",
  }),
  MESSAGE_FACTORY: Object.freeze({
    TOOL_CALL_UNKNOWN_SCRIPT: "messageFactoryToolCallUnknownScript",
    TOOL_CALL_NO_ARGUMENTS: "messageFactoryToolCallNoArguments",
    TOOL_CALL_SEMANTIC_LINE: "messageFactoryToolCallSemanticLine",
  }),
  RELAY: Object.freeze({
    SEPARATE_MODEL_PREFIX: "separateModelRelayPrefix",
    CONTENT_TRUNCATED_ELLIPSIS: "relayContentTruncatedEllipsis",
    CONTENT_TRANSFER_HINT: "relayContentTransferHint",
  }),
  STRUCTURED_ENVELOPE: Object.freeze({
    AGENT_HEADER: "structuredEnvelopeAgentHeader",
    CONSTRAINT_HEADER: "structuredEnvelopeConstraintHeader",
  }),
  PLANNING_RESULT: Object.freeze({
    DEFAULT_REASON_EMPTY_RESPONSE: "planningDefaultReasonEmptyResponse",
    DEFAULT_REASON_INVALID_NONEMPTY: "planningDefaultReasonInvalidNonempty",
    DEFAULT_REASON_RETRY_EXHAUSTED: "planningDefaultReasonRetryExhausted",
    DEFAULT_PLAN_TEXT: "planningDefaultPlanText",
  }),
  WORKFLOW_PROMPTS: Object.freeze({
    PLANNING_TOOL_DESCRIPTION_FALLBACK: "planningToolDescriptionFallback",
    PLANNING_PROMPT_TOOLS_HEADER: "planningPromptToolsHeader",
    PLANNING_CONTEXT_SUMMARY_HEADER: "planningContextSummaryHeader",
    PLANNING_SEPARATE_MODEL_EMPTY_RELAY: "planningSeparateModelEmptyRelay",
    POST_PLAN_FOLLOWUP_REFINEMENT: "postPlanFollowupRefinement",
    POST_PLAN_FOLLOWUP_REVISION: "postPlanFollowupRevision",
    POST_PLAN_FOLLOWUP_PLANNING: "postPlanFollowupPlanning",
    RESPONSIBILITY_STAGE_PLANNING: "responsibilityStagePlanning",
    RESPONSIBILITY_STAGE_REVISION: "responsibilityStageRevision",
    RESPONSIBILITY_STAGE_REFINEMENT: "responsibilityStageRefinement",
    RESPONSIBILITY_STAGE_SUMMARY: "responsibilityStageSummary",
    RESPONSIBILITY_STAGE_PHASE_ACCEPTANCE: "responsibilityStagePhaseAcceptance",
    RESPONSIBILITY_STAGE_FINAL_ACCEPTANCE: "responsibilityStageFinalAcceptance",
    RESPONSIBILITY_CONSTRAINT_TEMPLATE: "responsibilityConstraintTemplate",
    GUIDANCE_FAILURE_PROMPT_TEMPLATE: "guidanceFailurePromptTemplate",
    PLANNING_LATEST_USER_GOAL_FALLBACK: "planningLatestUserGoalFallback",
    PLANNING_MAIN_PROMPT_GOAL: "planningMainPromptGoal",
    PLANNING_MAIN_USER_GOAL_HEADER: "planningMainUserGoalHeader",
    PLANNING_MAIN_CONSTRAINT: "planningMainConstraint",
    PLANNING_MAIN_EXAMPLE_HEADER: "planningMainExampleHeader",
    PLANNING_MAIN_EXAMPLE_ADD: "planningMainExampleAdd",
    PLANNING_EMPTY_TEXT: "planningEmptyText",
    PLANNING_NO_FEEDBACK_FALLBACK: "planningNoFeedbackFallback",
    PLANNING_REVISION_CURRENT_PLAN_LABEL: "planningRevisionCurrentPlanLabel",
    PLANNING_REVISION_PROMPT_GOAL: "planningRevisionPromptGoal",
    PLANNING_REVISION_STATUS_HEADER: "planningRevisionStatusHeader",
    PLANNING_REVISION_COUNT_LINE: "planningRevisionCountLine",
    PLANNING_REVISION_LATEST_FEEDBACK_LABEL: "planningRevisionLatestFeedbackLabel",
    PLANNING_REVISION_CONSTRAINT: "planningRevisionConstraint",
    PLANNING_REVISION_EXAMPLE_HEADER: "planningRevisionExampleHeader",
    PLANNING_REVISION_EXAMPLE_UPDATE: "planningRevisionExampleUpdate",
    PLANNING_REVISION_EXAMPLE_ADD: "planningRevisionExampleAdd",
    PLANNING_REFINEMENT_PROMPT_GOAL: "planningRefinementPromptGoal",
    PLANNING_REFINEMENT_TARGETS_HEADER: "planningRefinementTargetsHeader",
    PLANNING_REFINEMENT_TARGET_IDS_HEADER: "planningRefinementTargetIdsHeader",
    PLANNING_REFINEMENT_TARGET_ONLY_CONSTRAINT: "planningRefinementTargetOnlyConstraint",
    PLANNING_REFINEMENT_EXISTING_SUBSTEPS_LABEL: "planningRefinementExistingSubstepsLabel",
    PLANNING_REFINEMENT_LATEST_FEEDBACK_HEADER: "planningRefinementLatestFeedbackHeader",
    PLANNING_REFINEMENT_EXAMPLE_HEADER: "planningRefinementExampleHeader",
    PLANNING_REFINEMENT_EXAMPLE_ADD: "planningRefinementExampleAdd",
    PLANNING_REFINEMENT_EXAMPLE_UPDATE: "planningRefinementExampleUpdate",
    GUIDANCE_SUMMARY_PROMPT_GOAL: "guidanceSummaryPromptGoal",
    GUIDANCE_SUMMARY_PROTOCOL_HINT: "guidanceSummaryProtocolHint",
    GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH: "guidanceSummarySampleRiskHigh",
    GUIDANCE_SUMMARY_DETAIL_HEADER: "guidanceSummaryDetailHeader",
    GUIDANCE_SUMMARY_DETAIL_SAMPLE: "guidanceSummaryDetailSample",
    GUIDANCE_SUMMARY_RULES: "guidanceSummaryRules",
    ACCEPTANCE_MAIN_PLAN_CONTEXT_HEADER: "acceptanceMainPlanContextHeader",
    PHASE_ACCEPTANCE_REQUEST_GOAL: "phaseAcceptanceRequestGoal",
    PHASE_ACCEPTANCE_REQUEST_CONSTRAINT: "phaseAcceptanceRequestConstraint",
    PHASE_ACCEPTANCE_CHECKLIST_TITLE: "phaseAcceptanceChecklistTitle",
    SUMMARY_CHECKLIST_TITLE: "summaryChecklistTitle",
    FINAL_ACCEPTANCE_REQUEST_GOAL: "finalAcceptanceRequestGoal",
    PLAN_CHECKLIST_CONTEXT_HEADER: "planChecklistContextHeader",
  }),
  WORKFLOW_PROTOCOLS: Object.freeze({
    PROTOCOL_PLANNING_MAIN_ACTION_ADD: "protocolPlanningMainActionAdd",
    PROTOCOL_PLANNING_MAIN_ACTION_UPDATE: "protocolPlanningMainActionUpdate",
    PROTOCOL_PLANNING_MAIN_ACTION_DELETE: "protocolPlanningMainActionDelete",
    PROTOCOL_PLANNING_MAIN_CANONICAL_ITEM_TEMPLATE: "protocolPlanningMainCanonicalItemTemplate",
    PROTOCOL_PLANNING_MAIN_TITLE: "protocolPlanningMainTitle",
    PROTOCOL_PLANNING_MAIN_HARD_CONSTRAINT: "protocolPlanningMainHardConstraint",
    PROTOCOL_PLANNING_MAIN_CANONICAL_TEMPLATE: "protocolPlanningMainCanonicalTemplate",
    PROTOCOL_PLANNING_REFINEMENT_TITLE: "protocolPlanningRefinementTitle",
    PROTOCOL_PLANNING_REFINEMENT_ACTION_ADD: "protocolPlanningRefinementActionAdd",
    PROTOCOL_PLANNING_REFINEMENT_ACTION_UPDATE: "protocolPlanningRefinementActionUpdate",
    PROTOCOL_PLANNING_REFINEMENT_ACTION_DELETE: "protocolPlanningRefinementActionDelete",
    PROTOCOL_PLANNING_REFINEMENT_HARD_CONSTRAINT: "protocolPlanningRefinementHardConstraint",
    PROTOCOL_PLANNING_REFINEMENT_ONE_LEVEL_CONSTRAINT: "protocolPlanningRefinementOneLevelConstraint",
    PROTOCOL_PLANNING_REFINEMENT_CANONICAL: "protocolPlanningRefinementCanonical",
    PROTOCOL_SUMMARY_LINE1: "protocolSummaryLine1",
    PROTOCOL_SUMMARY_LINE2: "protocolSummaryLine2",
    PROTOCOL_SUMMARY_LINE3: "protocolSummaryLine3",
    PROTOCOL_SUMMARY_LINE4: "protocolSummaryLine4",
    PROTOCOL_SUMMARY_LINE5: "protocolSummaryLine5",
    PROTOCOL_SUMMARY_LINE6: "protocolSummaryLine6",
    PROTOCOL_ACCEPTANCE_TITLE_PHASE: "protocolAcceptanceTitlePhase",
    PROTOCOL_ACCEPTANCE_TITLE_FINAL: "protocolAcceptanceTitleFinal",
    PROTOCOL_ACCEPTANCE_OUTPUT_RULE: "protocolAcceptanceOutputRule",
    PROTOCOL_ACCEPTANCE_COMMANDS_HEADER: "protocolAcceptanceCommandsHeader",
    PROTOCOL_ACCEPTANCE_COMMAND_ADD: "protocolAcceptanceCommandAdd",
    PROTOCOL_ACCEPTANCE_COMMAND_UPDATE: "protocolAcceptanceCommandUpdate",
    PROTOCOL_ACCEPTANCE_COMMAND_DELETE: "protocolAcceptanceCommandDelete",
    PROTOCOL_ACCEPTANCE_ID_RULES_HEADER: "protocolAcceptanceIdRulesHeader",
    PROTOCOL_ACCEPTANCE_ID_RULE1: "protocolAcceptanceIdRule1",
    PROTOCOL_ACCEPTANCE_ID_RULE2: "protocolAcceptanceIdRule2",
    PROTOCOL_ACCEPTANCE_STATUS_HEADER: "protocolAcceptanceStatusHeader",
    PROTOCOL_ACCEPTANCE_STATUS_RULE: "protocolAcceptanceStatusRule",
    PROTOCOL_ACCEPTANCE_EVIDENCE_RULE: "protocolAcceptanceEvidenceRule",
    SUMMARY_DETAIL_PATHS_HEADER: "summaryDetailPathsHeader",
    SUMMARY_DETAIL_PATHS_FOOTER: "summaryDetailPathsFooter",
  }),
  PLAN_REFINEMENT_TOOL: Object.freeze({
    DESCRIPTION: "planRefinementToolDescription",
    SUMMARY_DESCRIPTION: "planRefinementToolSummaryDescription",
    TARGET_MAIN_STEP_INDEXES_DESCRIPTION: "planRefinementTargetMainStepIndexesDescription",
    NOT_READY_REASON: "planRefinementNotReadyReason",
    CONVERGED_REASON: "planRefinementConvergedReason",
    FAILED_REASON: "planRefinementFailedReason",
  }),
  CHECKLIST: Object.freeze({
    TASK_DEFAULT_NAME_TEMPLATE: "checklistTaskDefaultNameTemplate",
  }),
  SYSTEM_PROMPT: Object.freeze({
    POLICY: "harnessPolicyPrompt",
    FINAL_RESPONSE: "harnessFinalResponsePrompt",
  }),
});

// Defaults (non-UI runtime fallback values)
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

// Prompt JSON schema examples
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

// Localized dictionary used by harness
// Prompt texts are managed in `shared/workflow/prompts.js`.
// Keep constants.js focused on non-prompt i18n copy (tool copy + runtime labels).
const I18N_TOOL_COPY = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    taskAcceptanceToolDescription:
      "请求任务验收：按 harness 插件任务清单输出验收报告；mode=active(主动) 或 forced(强行)。",
    taskAcceptanceModeDescription: "验收模式：active(主动) 或 forced(强行)。",
    planRefinementToolDescription: "在总计划完成后触发计划细化流程。",
    planRefinementToolSummaryDescription: "可选的小结文本，会作为计划细化上下文。",
    planRefinementNotReadyReason: "总计划流程尚未完成",
    planRefinementConvergedReason: "未找到可细化的主步骤",
    planRefinementFailedReason: "插件侧细化失败",
    planningDefaultReasonEmptyResponse: "规划输出为空，使用默认主计划",
    planningDefaultReasonInvalidNonempty: "规划输出无法解析，使用默认主计划",
    planningDefaultReasonRetryExhausted: "规划重试次数耗尽，使用默认主计划",
    guidanceReasonPendingSummaryOverflow: "存在待处理的溢出小结，优先执行小结",
    guidanceReasonPendingSummaryTurns: "存在待处理的小结，优先执行小结",
    guidanceReasonPendingGuidance: "存在待处理的 guidance，优先执行 guidance",
    guidanceReasonPendingRevision: "存在待处理的计划修订，优先执行修订",
    guidanceReasonPendingRefinement: "存在待处理的计划细化，优先执行细化",
    guidanceReasonIdle: "无待处理 guidance 动作",
    guidanceBlockedPhaseAcceptanceDeferred: "阶段验收被 guidance 优先级规则延后",
    planningReasonIdle: "规划触发器空闲",
    planningReasonSummaryThresholdTurns: "达到按轮次触发的小结阈值",
    planningReasonSummaryThresholdChars: "达到按字符数触发的小结阈值",
    planningReasonPlanUpdateThreshold: "达到计划修正触发阈值",
    planningReasonPhaseAcceptanceThreshold: "达到阶段验收触发阈值",
    planningReasonAfterLlmCapture: "LLM 返回后执行规划结果捕获",
    planningBlockedPlanUpdatePending: "计划修正被已有 pending plan-update 阻塞",
    planningBlockedPhaseAcceptanceHigherPriority: "阶段验收被更高优先级 pending 动作阻塞",
    acceptanceReasonOverflowForceAcceptance: "触发溢出强制验收",
    acceptanceReasonPhaseAcceptanceBlocked: "阶段验收被高优先级 pending 动作阻塞",
    acceptanceReasonPhaseAcceptancePending: "存在待处理的阶段验收",
    acceptanceReasonSemanticValidationPending: "存在待处理的语义验收",
    acceptanceReasonToolGuard: "执行验收工具守卫",
    acceptanceReasonBeforeTurnSetup: "回合开始执行验收工具初始化",
    acceptanceReasonFinalOutputOverflowFallback: "最终输出阶段触发溢出兜底验收",
    acceptanceReasonFinalOutputAcceptanceFallback: "最终输出阶段执行验收兜底流程",
    acceptanceReasonAfterLlmCapture: "LLM 返回后执行验收结果捕获",
    acceptanceReasonIdle: "无待处理验收动作",
    acceptanceBlockedPhaseAcceptanceHigherPriority:
      "阶段验收被 summary/guidance/plan-update 等高优先级动作阻塞",
    acceptanceBlockedSemanticValidationDeferred: "语义验收被主选择动作延后",
    reviewReasonHookReview: "在当前 hook 生成 review 报告",
  }),
  [LOCALE.EN_US]: Object.freeze({
    taskAcceptanceToolDescription:
      "Request task acceptance: validate completion against the harness checklist; mode=active or forced.",
    taskAcceptanceModeDescription: "Acceptance mode: active or forced.",
    planRefinementToolDescription: "Trigger planning refinement flow after main plan is ready.",
    planRefinementToolSummaryDescription: "Optional summary text used as refinement context.",
    planRefinementNotReadyReason: "main planning flow is not completed yet",
    planRefinementConvergedReason: "no refinable main step found",
    planRefinementFailedReason: "plugin-side refinement failed",
    planningDefaultReasonEmptyResponse: "Planning output is empty; fallback to default main plan",
    planningDefaultReasonInvalidNonempty:
      "Planning output is non-empty but invalid; fallback to default main plan",
    planningDefaultReasonRetryExhausted:
      "Planning retries exhausted; fallback to default main plan",
    guidanceReasonPendingSummaryOverflow:
      "Pending overflow summary exists; prioritize summary first",
    guidanceReasonPendingSummaryTurns:
      "Pending turn-based summary exists; prioritize summary first",
    guidanceReasonPendingGuidance:
      "Pending guidance exists; prioritize guidance first",
    guidanceReasonPendingRevision:
      "Pending plan revision exists; prioritize revision first",
    guidanceReasonPendingRefinement:
      "Pending plan refinement exists; prioritize refinement first",
    guidanceReasonIdle: "No pending guidance action",
    guidanceBlockedPhaseAcceptanceDeferred:
      "Phase acceptance is deferred by guidance priority order",
    planningReasonIdle: "Planning triggers are idle",
    planningReasonSummaryThresholdTurns: "Reached turn-based summary threshold",
    planningReasonSummaryThresholdChars: "Reached char-based summary threshold",
    planningReasonPlanUpdateThreshold: "Reached plan-update trigger threshold",
    planningReasonPhaseAcceptanceThreshold: "Reached phase-acceptance trigger threshold",
    planningReasonAfterLlmCapture: "Capture planning result after LLM response",
    planningBlockedPlanUpdatePending: "Plan update is blocked by existing pending plan-update",
    planningBlockedPhaseAcceptanceHigherPriority:
      "Phase acceptance is blocked by higher-priority pending actions",
    acceptanceReasonOverflowForceAcceptance: "Triggered overflow-forced acceptance",
    acceptanceReasonPhaseAcceptanceBlocked:
      "Phase acceptance is blocked by higher-priority pending actions",
    acceptanceReasonPhaseAcceptancePending: "Pending phase acceptance exists",
    acceptanceReasonSemanticValidationPending:
      "Pending acceptance semantic validation exists",
    acceptanceReasonToolGuard: "Run acceptance tool guard",
    acceptanceReasonBeforeTurnSetup:
      "Run acceptance guard setup at turn start",
    acceptanceReasonFinalOutputOverflowFallback:
      "Run final-output overflow fallback acceptance",
    acceptanceReasonFinalOutputAcceptanceFallback:
      "Run final-output acceptance fallback flow",
    acceptanceReasonAfterLlmCapture:
      "Capture acceptance result after LLM response",
    acceptanceReasonIdle: "No pending acceptance action",
    acceptanceBlockedPhaseAcceptanceHigherPriority:
      "Phase acceptance is blocked by summary/guidance/plan-update blockers",
    acceptanceBlockedSemanticValidationDeferred:
      "Semantic validation is deferred by current primary choice",
    reviewReasonHookReview: "Generate review report for current hook",
  }),
});

const I18N_RUNTIME_LABELS = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[来自harness外部模型输出/{purpose}]",
    reviewHeader: "[Harness-Review]",
    harnessPolicyPrompt: 
      "Noobot Harness 提醒：遵守用户隔离；附件先转文本再处理；未知规则、模板、路径、配置先读后用；最终回复保持精简且完整。",
    harnessFinalResponsePrompt:
      "最终回复请包含：做了什么、改了哪些文件、验证情况或未验证原因、下一步建议。",
    acceptanceRawTitle: "[Harness-验收]",
    acceptanceRawForcedReasonField: "强制原因",
    acceptanceRawPlanTextField: "计划文本",
    acceptanceRawChecklistHeader: "验收清单：",
    acceptanceRawSummaryField: "汇总",
    acceptanceRawSemanticField: "语义验收",
    acceptanceRawModelField: "模型验收",
    acceptanceRawSummaryDetailPathsField: "小结明细路径",
    acceptanceModeLabel: "模式",
    acceptanceForcedReasonLabel: "强制原因",
    acceptanceAcceptedAtLabel: "验收时间",
    acceptancePlanTextLabel: "计划文本",
    acceptanceChecklistLabel: "验收清单",
    acceptanceSummaryLabel: "汇总",
    acceptanceSemanticValidationLabel: "语义验收",
    acceptanceModelAcceptanceLabel: "模型验收结果",
    acceptanceSummaryDetailPathsLabel: "小结明细路径",
    acceptanceEmptyLine: "- （空）",
    acceptanceDigestTitle: "### [Harness-验收]",
    acceptanceDigestModeLabel: "模式",
    acceptanceDigestAcceptedAtLabel: "验收时间",
    acceptanceDigestPlanTextLabel: "计划文本",
    acceptanceDigestSummaryLabel: "汇总",
    acceptanceDigestSemanticValidationLabel: "语义验收",
    acceptanceDigestSummaryDetailPathsLabel: "小结明细路径",
    acceptanceDigestNoDetailPaths: "（无）",
    acceptanceChecklistArtifactsGeneratedNotice:
      "已生成 harness 清单附件，详见 transferEnvelope(s)。",
    acceptanceForcedReasonRebuiltArtifacts:
      "补建验收报告_用于附件生成",
    acceptanceForcedReasonOverflowFallback:
      "上下文溢出_最终输出兜底强制验收",
    acceptanceForcedReasonNoActiveRequest:
      "未主动请求验收_最终输出兜底",
    acceptanceSignalAttachmentKeywords: "附件|attachment",
    acceptanceSignalSubtaskKeywords: "子任务|subtask",
    acceptanceSignalSubtaskStartKeywords: "开启|start",
    acceptanceSignalSubtaskWaitKeywords: "等待|wait",
    planningToolDescriptionFallback: "（无说明）",
    planningLatestUserGoalFallback: "（未获取到用户目标）",
    planningPromptToolsHeader: "可用工具（name/description），规划必须参考：",
    planningContextSummaryHeader: "规划输入上下文摘要（精简）如下，必须完整参考：",
    planningSeparateModelEmptyRelay: "无",
    planningEmptyText: "（空）",
    planningNoFeedbackFallback: "（无）",
    planningDefaultPlanText:
      "1. 需求澄清与约束确认\n2. 实施并验证核心改动\n3. 最终验收与交付",
    postPlanFollowupPlanning:
      "计划已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。",
    postPlanFollowupRevision:
      "计划修正已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。",
    postPlanFollowupRefinement:
      "计划细化已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。",
    responsibilityStagePlanning: "规划",
    responsibilityStageRevision: "计划修正",
    responsibilityStageRefinement: "计划细化",
    responsibilityStageSummary: "小结",
    responsibilityStagePhaseAcceptance: "阶段验收",
    responsibilityStageFinalAcceptance: "总体验收",
    responsibilityConstraintTemplate:
      "职责约束：你当前仅负责「{stage}」。只做该职责范围内的事，禁止越权。",
    guidanceFailurePromptTemplate:
      "工具失败达到阈值({reason})，请分析工具失败原因，并且给予修复建议。",
    acceptanceMainPlanContextHeader: "计划清单上下文如下（验收时必须完整对齐）：",
    phaseAcceptanceRequestGoal:
      "目标：基于前面的上下文与 system 提供的计划修正后计划清单，仅进行当前阶段验收。",
    phaseAcceptanceRequestConstraint:
      "这不是总体验收；除非上下文能证明全部完成，否则不要判断整个任务已完成。",
    finalAcceptanceRequestGoal:
      "目标：基于 system 提供的完整主计划上下文与最终输出进行验收。",
    phaseAcceptanceChecklistTitle:
      "阶段验收清单 #{index}/{total}（总体验收时必须参考）：",
    summaryChecklistTitle:
      "小结清单 #{index}/{total}（阶段验收时必须参考）：",
    planningMainPromptGoal:
      "目标：根据用户需求生成宏观主计划。仅限宏观步骤，严禁输出任何子计划或实施细节。",
    planningMainUserGoalHeader: "【用户目标】",
    planningMainConstraint:
      "约束：主计划ID 必须是数字（仅阿拉伯数字）。",
    planningMainExampleHeader: "【输出示例】",
    planningMainExampleAdd: "ADD [主计划ID] [主计划内容]",
    planningRevisionPromptGoal:
      "目标：基于最新反馈修正宏观主计划。仅限操作主计划ID，严禁涉及子计划。",
    planningRevisionStatusHeader: "【当前状态】",
    planningRevisionCountLine:
      "已修正次数：{revisionCount}/{maxAttempts}",
    planningRevisionCurrentPlanLabel: "当前主计划：",
    planningRevisionLatestFeedbackLabel: "最新反馈：",
    planningRevisionConstraint:
      "约束：主计划ID 必须是数字（仅阿拉伯数字）。",
    planningRevisionExampleHeader: "【输出示例】",
    planningRevisionExampleUpdate:
      "UPDATE [主计划ID] [修改后的主计划内容]",
    planningRevisionExampleAdd:
      "ADD [主计划ID] [新增主计划内容]",
    planningRefinementPromptGoal:
      "目标：基于修正后的主计划，仅细化指定主计划ID，生成具体可执行的子步骤。",
    planningRefinementTargetsHeader: "【修正后的主计划（目标项）】",
    planningRefinementTargetIdsHeader: "【本次需要细化的主计划ID】",
    planningRefinementTargetOnlyConstraint:
      "仅允许细化上述目标ID，禁止输出其他主计划ID下的子计划。",
    planningRefinementExistingSubstepsLabel: "已有子步骤：",
    planningRefinementLatestFeedbackHeader: "【最新反馈】",
    planningRefinementExampleHeader: "【输出示例】",
    planningRefinementExampleAdd:
      "ADD [主序号.子序号] [抽象子步骤内容A]",
    planningRefinementExampleUpdate:
      "UPDATE [主序号.子序号] [抽象子步骤内容B]",
    guidanceSummaryPromptGoal:
      "请先对已完成内容进行小结（注意是小结，不是总结）。",
    guidanceSummaryProtocolHint:
      "请优先使用纯文本 summary_text_v2 协议：",
    guidanceSummarySampleRiskHigh:
      "2. [plan=8][status=todo][risk=高][evidence=...] ...",
    guidanceSummaryDetailHeader: "## 详细明细",
    guidanceSummaryDetailSample: "- 证据/日志/风险分析 ...",
    guidanceSummaryRules:
      "要求：必须参考 system 中的【当前完整计划清单】作为当前完整计划；SUMMARY_OVERVIEW 保持简短、面向主流程决策；每条小结必须包含 plan 与 evidence，evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；用 [status=todo] 输出待处理风险点（写清影响与建议缓解动作）；SUMMARY_DETAIL 写充分细节。",
    relayContentTruncatedEllipsis: "……【已截断】",
    relayContentTransferHint: "详细内容已保存至 transferEnvelope(s)。",
    checklistTaskDefaultNameTemplate: "任务 {index}",
    planChecklistContextHeader: "【当前完整计划清单】",
    phaseAcceptanceFinalOutputFallback:
      "总体验收前阶段验收：checklistCount={checklistCount}，successfulToolCount={successfulToolCount}。",
    structuredEnvelopeAgentHeader: "[Agent消息上下文]",
    structuredEnvelopeConstraintHeader: "[约束上下文]",
    protocolPlanningMainTitle: "【ID+PATCH 协议语法】",
    protocolPlanningMainActionAdd: "ADD [新主计划ID] [主计划内容]",
    protocolPlanningMainActionUpdate: "UPDATE [已有主计划ID] [修改后的内容]",
    protocolPlanningMainActionDelete: "DELETE [已有主计划ID]",
    protocolPlanningMainHardConstraint:
      "硬性约束：主计划ID只能使用阿拉伯数字正整数（1,2,3...），禁止使用 P1/A1/Step1/一/第一步 等非纯数字 ID。",
    protocolPlanningMainCanonicalTemplate: "推荐统一输出风格：{canonical}",
    protocolPlanningMainCanonicalItemTemplate: "{action} [主计划ID] ...",
    protocolPlanningRefinementTitle:
      "【ID+PATCH 协议语法】(子计划 ID 格式固定为 [主序号.子序号]，且 [主序号] 必须属于目标主计划 ID 集合)",
    protocolPlanningRefinementActionAdd:
      "ADD [主序号.子序号] [细化内容]",
    protocolPlanningRefinementActionUpdate:
      "UPDATE [主序号.子序号] [修改后的内容]",
    protocolPlanningRefinementActionDelete:
      "DELETE [主序号.子序号]",
    protocolPlanningRefinementHardConstraint:
      "硬性约束：主序号与子序号都必须是阿拉伯数字正整数（如 1.1、2.3），禁止 P1.1/A2.3/一.一 等非纯数字形式。",
    protocolPlanningRefinementOneLevelConstraint:
      "约束：仅允许一级子计划 ID，禁止输出 1.1.1 这类二级子计划 ID。",
    protocolPlanningRefinementCanonical:
      "推荐统一输出风格：ADD [主序号.子序号] ... / UPDATE [主序号.子序号] ... / DELETE [主序号.子序号] ...",
    protocolSummaryLine1: "建议使用 summary_patch_v1（与计划 patch 协议独立）。",
    protocolSummaryLine2: "语法：",
    protocolSummaryLine3:
      "ADD S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] [小结内容]",
    protocolSummaryLine4:
      "UPDATE S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] [小结内容]",
    protocolSummaryLine5: "DELETE S[小结ID]",
    protocolSummaryLine6:
      "必须对齐当前完整计划清单；evidence 必须来自上下文、工具结果或模型最终输出，禁止编造。若无法按协议输出，返回非空文本也可，但仍需写明计划ID、状态、证据与问题说明。小结后请继续任务。",
    protocolAcceptanceTitlePhase:
      "【验收 ID+PATCH 协议：acceptance_patch_v1 / 阶段验收】",
    protocolAcceptanceTitleFinal:
      "【验收 ID+PATCH 协议：acceptance_patch_v1 / 总体验收】",
    protocolAcceptanceOutputRule:
      "每行输出一条命令。优先使用该协议；若无法严格遵循，仍需返回非空纯文本。",
    protocolAcceptanceCommandsHeader: "命令：",
    protocolAcceptanceCommandAdd:
      "ADD A[验收ID] plan=计划ID status=[pass|warn|fail] risk=[low|medium|high] evidence=[简短证据] [验收结论]",
    protocolAcceptanceCommandUpdate:
      "UPDATE A[验收ID] plan=计划ID status=[pass|warn|fail] risk=[low|medium|high] evidence=[简短证据] [验收结论]",
    protocolAcceptanceCommandDelete: "DELETE A[验收ID]",
    protocolAcceptanceIdRulesHeader: "ID 规则：",
    protocolAcceptanceIdRule1:
      "A[验收ID] 在本次验收报告内稳定，从 A1 开始按 1 递增。",
    protocolAcceptanceIdRule2:
      "plan=计划ID 必须引用 system 提供的计划清单 ID；若存在子计划，可使用 2.1 这类子计划 ID。",
    protocolAcceptanceStatusHeader: "状态语义：",
    protocolAcceptanceStatusRule:
      "pass = 有证据支撑且通过；warn = 部分通过或存在低/中风险；fail = 未满足、无证据或阻塞。",
    protocolAcceptanceEvidenceRule:
      "evidence 必须简短，并来自上下文、工具结果或最终输出；不要编造证据。",
    planRefinementTargetMainStepIndexesDescription:
      "可选：指定要细化的主计划 ID 列表，如 [2,3]。",
    taskAcceptanceForcedReasonOverflowInFlow:
      "上下文溢出_流程内强制验收",
    taskAcceptanceForcedReasonToolRequested:
      "工具主动请求强制验收",
    messageFactoryToolCallUnknownScript: "未知脚本",
    messageFactoryToolCallNoArguments: "无参数",
    messageFactoryToolCallSemanticLine: "语义执行 {name}脚本,参数{args}",
    summaryDetailPathsHeader: "【SUMMARY_DETAIL_PATHS】",
    summaryDetailPathsFooter: "【SUMMARY_DETAIL_PATHS_END】",
  }),
  [LOCALE.EN_US]: Object.freeze({
    forcedAcceptanceHeader: "[Harness-Forced-Acceptance]",
    separateModelRelayPrefix: "[Relay from harness external model/{purpose}]",
    reviewHeader: "[Harness-Review]",
    harnessPolicyPrompt:
      "Noobot Harness reminder: enforce user isolation; convert attachments to text before processing; read unknown rules/templates/paths/configuration before use; keep the final response concise and complete.",
    harnessFinalResponsePrompt:
      "Final response should include: what was done, which files were changed, validation status (or why not validated), and next-step suggestions.",
    acceptanceRawTitle: "[Harness-Acceptance]",
    acceptanceRawForcedReasonField: "forcedReason",
    acceptanceRawPlanTextField: "planText",
    acceptanceRawChecklistHeader: "Acceptance Checklist:",
    acceptanceRawSummaryField: "summary",
    acceptanceRawSemanticField: "semanticValidation",
    acceptanceRawModelField: "modelAcceptance",
    acceptanceRawSummaryDetailPathsField: "summaryDetailPaths",
    acceptanceModeLabel: "Mode",
    acceptanceForcedReasonLabel: "Forced reason",
    acceptanceAcceptedAtLabel: "Accepted at",
    acceptancePlanTextLabel: "Plan text",
    acceptanceChecklistLabel: "Acceptance checklist",
    acceptanceSummaryLabel: "Summary",
    acceptanceSemanticValidationLabel: "Semantic validation",
    acceptanceModelAcceptanceLabel: "Model acceptance",
    acceptanceSummaryDetailPathsLabel: "Summary detail paths",
    acceptanceEmptyLine: "- (empty)",
    acceptanceDigestTitle: "### [Harness-Acceptance]",
    acceptanceDigestModeLabel: "Mode",
    acceptanceDigestAcceptedAtLabel: "Accepted At",
    acceptanceDigestPlanTextLabel: "Plan Text",
    acceptanceDigestSummaryLabel: "Summary",
    acceptanceDigestSemanticValidationLabel: "Semantic Validation",
    acceptanceDigestSummaryDetailPathsLabel: "Summary Detail Paths",
    acceptanceDigestNoDetailPaths: "-",
    acceptanceChecklistArtifactsGeneratedNotice:
      "Harness checklist artifacts generated. See transferEnvelope(s) for details.",
    acceptanceForcedReasonRebuiltArtifacts:
      "Rebuilt acceptance report for artifact generation",
    acceptanceForcedReasonOverflowFallback:
      "Context overflow (final-output fallback forced acceptance)",
    acceptanceForcedReasonNoActiveRequest:
      "No active acceptance request (final-output fallback)",
    acceptanceSignalAttachmentKeywords: "attachment|附件",
    acceptanceSignalSubtaskKeywords: "subtask|子任务",
    acceptanceSignalSubtaskStartKeywords: "start|开启",
    acceptanceSignalSubtaskWaitKeywords: "wait|等待",
    planningToolDescriptionFallback: "(no description)",
    planningLatestUserGoalFallback: "N/A",
    planningPromptToolsHeader: "Available tools (name/description), must be referenced:",
    planningContextSummaryHeader: "Planning context summary (compact). Must be fully considered:",
    planningSeparateModelEmptyRelay: "None",
    planningEmptyText: "(empty)",
    planningNoFeedbackFallback: "N/A",
    planningDefaultPlanText:
      "1. Clarify requirements and constraints\n2. Implement and verify core changes\n3. Final acceptance and delivery",
    postPlanFollowupPlanning:
      "Plan is ready. Continue the task step by step with tools.",
    postPlanFollowupRevision:
      "Plan revision is done. Continue the task step by step with tools.",
    postPlanFollowupRefinement:
      "Plan refinement is done. Continue the task step by step with tools.",
    responsibilityStagePlanning: "planning",
    responsibilityStageRevision: "plan revision",
    responsibilityStageRefinement: "plan refinement",
    responsibilityStageSummary: "summary",
    responsibilityStagePhaseAcceptance: "phase acceptance",
    responsibilityStageFinalAcceptance: "final acceptance",
    responsibilityConstraintTemplate:
      "Responsibility constraint: You are only responsible for {stage}. Do only this scope; do not perform out-of-scope tasks.",
    guidanceFailurePromptTemplate:
      "Guidance triggered by tool failure threshold ({reason}). Please analyze the causes of tool failures and provide suggestions for fixes.",
    acceptanceMainPlanContextHeader:
      "Plan checklist context (must be fully respected during acceptance validation):",
    phaseAcceptanceRequestGoal:
      "Goal: Perform phase acceptance for the current stage only, based on the preceding context and the system-provided revised plan checklist.",
    phaseAcceptanceRequestConstraint:
      "This is not final acceptance. Do not conclude the whole task is complete unless the context proves it.",
    finalAcceptanceRequestGoal:
      "Goal: Validate acceptance from the system-provided complete main plan context and final output.",
    phaseAcceptanceChecklistTitle:
      "Phase acceptance checklist #{index}/{total} (must be considered during final acceptance):",
    summaryChecklistTitle:
      "Summary checklist #{index}/{total} (must be considered during phase acceptance):",
    planningMainPromptGoal:
      "Goal: Generate a high-level main plan from the user goal. Only high-level steps; no sub-steps or implementation details.",
    planningMainUserGoalHeader: "[User Goal]",
    planningMainConstraint:
      "Constraint: main_plan_id must be numeric (Arabic digits only).",
    planningMainExampleHeader: "[Example]",
    planningMainExampleAdd:
      "ADD [main_plan_id] [main plan content]",
    planningRevisionPromptGoal:
      "Goal: Revise the high-level main plan based on latest feedback. Only operate on main_plan_id; do not include sub-steps.",
    planningRevisionStatusHeader: "[Current Status]",
    planningRevisionCountLine:
      "Revision count: {revisionCount}/{maxAttempts}",
    planningRevisionCurrentPlanLabel: "Current main plan:",
    planningRevisionLatestFeedbackLabel: "Latest feedback:",
    planningRevisionConstraint: "",
    planningRevisionExampleHeader: "",
    planningRevisionExampleUpdate: "",
    planningRevisionExampleAdd: "",
    planningRefinementPromptGoal:
      "Goal: Decompose and refine specific target main plans into executable sub-steps.",
    planningRefinementTargetsHeader: "[Revised Main Plan Targets]",
    planningRefinementTargetIdsHeader: "[Target Main Plan IDs]",
    planningRefinementTargetOnlyConstraint:
      "Only refine the target IDs listed above. Do not refine any other main-plan ID.",
    planningRefinementExistingSubstepsLabel: "Existing sub-steps:",
    planningRefinementLatestFeedbackHeader: "[Latest Feedback]",
    planningRefinementExampleHeader: "",
    planningRefinementExampleAdd: "",
    planningRefinementExampleUpdate: "",
    guidanceSummaryPromptGoal:
      "Provide a guidance summary of completed items and risks.",
    guidanceSummaryProtocolHint:
      "Use plain-text summary_text_v2 blocks:",
    guidanceSummarySampleRiskHigh:
      "2. [plan=8][status=todo][risk=high][evidence=...] ...",
    guidanceSummaryDetailHeader: "## Detailed notes",
    guidanceSummaryDetailSample: "- evidence / logs / risk analysis ...",
    guidanceSummaryRules:
      "Rules: use the [Current Complete Plan Checklist] system context as the current complete plan; SUMMARY_OVERVIEW should be short and action-oriented for main agent context; every summary item must include plan and evidence; evidence must come from context, tool results, or model final output and must not be fabricated; include pending risk points with [status=todo] (plus impact and mitigation hints); SUMMARY_DETAIL contains detailed evidence and can be longer.",
    relayContentTruncatedEllipsis: "... [truncated]",
    relayContentTransferHint: "Details are stored in transferEnvelope(s).",
    checklistTaskDefaultNameTemplate: "Task {index}",
    planChecklistContextHeader: "[Current Complete Plan Checklist]",
    phaseAcceptanceFinalOutputFallback:
      "Phase acceptance before final acceptance: checklistCount={checklistCount}, successfulToolCount={successfulToolCount}.",
    structuredEnvelopeAgentHeader: "[Agent message context]",
    structuredEnvelopeConstraintHeader: "[Constraint context]",
    protocolPlanningMainTitle: "[ID+PATCH Syntax]",
    protocolPlanningMainActionAdd: "ADD [new_main_plan_id] [main plan content]",
    protocolPlanningMainActionUpdate:
      "UPDATE [existing_main_plan_id] [updated content]",
    protocolPlanningMainActionDelete: "DELETE [existing_main_plan_id]",
    protocolPlanningMainHardConstraint:
      "Hard constraint: main_plan_id must be Arabic digits only (1,2,3...). Do NOT use P1/A1/Step1/Chinese numerals.",
    protocolPlanningMainCanonicalTemplate:
      "Canonical output style (recommended): {canonical}",
    protocolPlanningMainCanonicalItemTemplate: "{action} [main_plan_id] ...",
    protocolPlanningRefinementTitle:
      "[ID+PATCH Syntax] (sub-plan ID format: [main-id.sub-id], and [main-id] must belong to target main plan IDs)",
    protocolPlanningRefinementActionAdd: "ADD [main-id.sub-id] [content]",
    protocolPlanningRefinementActionUpdate:
      "UPDATE [main-id.sub-id] [updated content]",
    protocolPlanningRefinementActionDelete: "DELETE [main-id.sub-id]",
    protocolPlanningRefinementHardConstraint:
      "Hard constraint: main-id and sub-id must be Arabic digits only (e.g., 1.1, 2.3). Do NOT use P1.1/A2.3/Chinese numerals.",
    protocolPlanningRefinementOneLevelConstraint:
      "Constraint: only one-level sub-plan IDs are allowed. Do not output IDs like 1.1.1.",
    protocolPlanningRefinementCanonical:
      "Canonical output style (recommended): ADD [main-id.sub-id] ... / UPDATE [main-id.sub-id] ... / DELETE [main-id.sub-id] ...",
    protocolSummaryLine1:
      "Prefer summary_patch_v1 (independent from plan patch protocol).",
    protocolSummaryLine2: "Syntax:",
    protocolSummaryLine3:
      "ADD S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] [summary content]",
    protocolSummaryLine4:
      "UPDATE S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] [summary content]",
    protocolSummaryLine5: "DELETE S[summary_id]",
    protocolSummaryLine6:
      "Align with the current complete plan checklist; evidence must come from context, tool results, or model final output and must not be fabricated. If protocol cannot be followed, any non-empty text is acceptable, but still include plan ID, status, evidence, and issue notes. Then continue with the task.",
    protocolAcceptanceTitlePhase:
      "[Acceptance ID+PATCH Protocol: acceptance_patch_v1 / phase]",
    protocolAcceptanceTitleFinal:
      "[Acceptance ID+PATCH Protocol: acceptance_patch_v1 / final]",
    protocolAcceptanceOutputRule:
      "Output one command per line. Prefer this protocol; if impossible, still return non-empty plain text.",
    protocolAcceptanceCommandsHeader: "Commands:",
    protocolAcceptanceCommandAdd:
      "ADD A[acceptance_id] plan=plan_id status=[pass|warn|fail] risk=[low|medium|high] evidence=[short_evidence] [acceptance conclusion]",
    protocolAcceptanceCommandUpdate:
      "UPDATE A[acceptance_id] plan=plan_id status=[pass|warn|fail] risk=[low|medium|high] evidence=[short_evidence] [acceptance conclusion]",
    protocolAcceptanceCommandDelete: "DELETE A[acceptance_id]",
    protocolAcceptanceIdRulesHeader: "ID rules:",
    protocolAcceptanceIdRule1:
      "A[acceptance_id] is stable inside this acceptance report, starts from A1, and increases by 1.",
    protocolAcceptanceIdRule2:
      "plan=plan_id references the system-provided plan checklist ID; sub-plan IDs such as 2.1 are allowed when present.",
    protocolAcceptanceStatusHeader: "Status semantics:",
    protocolAcceptanceStatusRule:
      "pass = accepted with evidence; warn = partially accepted or has low/medium risk; fail = unmet, unsupported, or blocked.",
    protocolAcceptanceEvidenceRule:
      "Evidence must be short and grounded in context/tool results/final output. Do not invent evidence.",
    planRefinementTargetMainStepIndexesDescription:
      "Optional: target main-plan ID list to refine, e.g. [2,3].",
    taskAcceptanceForcedReasonOverflowInFlow:
      "Context overflow (in-flow forced acceptance)",
    taskAcceptanceForcedReasonToolRequested:
      "Tool-requested forced acceptance",
    messageFactoryToolCallUnknownScript: "unknown_script",
    messageFactoryToolCallNoArguments: "none",
    messageFactoryToolCallSemanticLine:
      "Semantic execution: run {name} script with arguments {args}",
    summaryDetailPathsHeader: "[SUMMARY_DETAIL_PATHS]",
    summaryDetailPathsFooter: "[SUMMARY_DETAIL_PATHS_END]",
  }),
});

export const I18N_TEXT = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    ...I18N_TOOL_COPY[LOCALE.ZH_CN],
    ...I18N_RUNTIME_LABELS[LOCALE.ZH_CN],
  }),
  [LOCALE.EN_US]: Object.freeze({
    ...I18N_TOOL_COPY[LOCALE.EN_US],
    ...I18N_RUNTIME_LABELS[LOCALE.EN_US],
  }),
});
