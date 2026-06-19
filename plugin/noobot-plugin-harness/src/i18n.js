/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const LOCALE = Object.freeze({
  ZH_CN: "zh-CN",
  EN_US: "en-US",
});


// -----------------------------------------------------------------------------
// Harness 默认场景策略文本
// -----------------------------------------------------------------------------
// 这里是 general / text / programming 三个场景的默认策略正文。
// 这些文本会并入主流程 system 层 [HARNESS_POLICY_SELECTION] 策略消息；动态策略只替换正文部分。
export const HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    general: `通用场景策略：
1. 先读必要上下文，再做最小可逆动作；执行后必须检查、测试、对比或观察结果。
2. 失败先按反馈修正并重试；信息不完整、质量不确定等普通风险转成检查/验证/对比动作，不阻塞推进。
3. 只有不可逆/破坏性、安全隐私、生产/资金、高成本外部动作、公开承诺或需求冲突才停下确认。
4. 风格偏好、未来优化等信息性风险只记录，不阻塞执行。`,

    text: `文本场景策略：
1. 复杂任务必须先分文件：按文件拆成交付单元，逐文件产出与维护；不要把完整内容一次写进单个文件或单次回复。
2. 边查/边搜/边核对，边写/边产出；不要等资料全部收集完才开始产出。
3. 建议每轮推进一个可交付单元，如文件、章节、表格、摘要、清单、对比或阶段稿，并标明来源、假设或待核对项。
4. 外部文本到手先保真消费，提取来源路径、事实、约束、依据、交付要求和可复用片段。
5. 每批轻量检查来源、覆盖、关键事实和格式；普通不确定性写入说明或待核对项后继续推进。
6. 只有合规、安全、承诺、不可逆、高成本外部动作或明确需求冲突才停下确认。`,

    programming: `编程场景策略：
1. 先读必要代码、配置、测试和上下文，做最小切片可逆改动；循环执行 -> 验证/反馈 -> 修正 -> 继续。
2. 验证是完成条件：优先跑相关测试、lint、类型检查或构建；失败先按错误修正并重试。
3. 调用链不确定、测试可能失败、边界不全、类型/构建风险等普通风险不阻塞改动，必须转成验证动作。
4. 只有破坏性/不可逆、安全/密钥/权限、生产数据/配置、破坏公开 API、无法合理假设的需求冲突或高代价且无法验证时才停下确认。
5. 命名风格、未来重构、更优雅方案等信息性风险只记录，不阻塞执行。`,
  }),
  [LOCALE.EN_US]: Object.freeze({
    general: `General-scenario policy:
1. Read necessary context, then take the smallest reversible action; after acting, check, test, compare, or observe the result.
2. Fix failures and retry; incomplete information or quality uncertainty should become inspection/verification/comparison actions, not blockers.
3. Stop for confirmation only for irreversible/destructive actions, security/privacy, production/money, costly external actions, public commitments, or requirement conflicts.
4. Style preferences and future improvements are informational; record them without blocking execution.`,

    text: `Text-scenario policy:
1. Complex tasks must be split into files first: make each file a deliverable unit and produce/maintain files one by one; do not put the full content into one file or one response.
2. Search/check while writing and producing; do not wait until all material is collected before producing.
3. It is recommended to advance one deliverable unit each turn, such as a file, section, table, summary, checklist, comparison, or stage draft, and mark sources, assumptions, or items to verify.
4. Faithfully consume external text once available; extract source paths, facts, constraints, evidence, delivery requirements, and reusable snippets.
5. For each batch, lightly check source traceability, coverage, key facts, and format; record ordinary uncertainty as notes or items to verify and continue.
6. Stop for confirmation only for compliance, safety, commitments, irreversible actions, costly external actions, or clear requirement conflicts.`,

    programming: `Programming-scenario policy:
1. Read necessary code, configuration, tests, and context, then make the smallest-slice reversible change; loop execute -> verify/feedback -> fix -> continue.
2. Verification is required for completion: prefer relevant tests, lint, type checks, or builds; fix failures and retry.
3. Uncertain call chains, likely test failures, incomplete edge cases, or type/build risk do not block edits; convert them into verification actions.
4. Stop for confirmation only for destructive/irreversible changes, security/secrets/permissions, production data/config, breaking public APIs, unresolvable requirement conflicts, or costly unverifiable changes.
5. Naming style, future refactors, and more elegant approaches are informational; record them without blocking execution.`,
  }),
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
    COMPLETE_PLAN_CHECKLIST_LABEL: "acceptanceCompletePlanChecklistLabel",
    LATEST_COMPLETE_SUMMARY_TITLE: "acceptanceLatestCompleteSummaryTitle",
    COLLAPSE_ACCEPTANCE_TITLE: "acceptanceCollapseAcceptanceTitle",
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
    RESPONSIBILITY_SCENARIO_MISMATCH_PROTOCOL:
      "responsibilityScenarioMismatchProtocol",
    SCENARIO_POLICY_GENERAL: "scenarioPolicyGeneral",
    SCENARIO_POLICY_TEXT: "scenarioPolicyText",
    SCENARIO_POLICY_PROGRAMMING: "scenarioPolicyProgramming",
    GUIDANCE_FAILURE_PROMPT_TEMPLATE: "guidanceFailurePromptTemplate",
    DYNAMIC_POLICY_PROMPT_PROTOCOL_INSTRUCTION:
      "dynamicPolicyPromptProtocolInstruction",
    PLANNING_LATEST_USER_GOAL_FALLBACK: "planningLatestUserGoalFallback",
    PLANNING_MAIN_PROMPT_GOAL: "planningMainPromptGoal",
    PLANNING_MAIN_PROMPT_GOAL_PROGRAMMING_FAST:
      "planningMainPromptGoalProgrammingFast",
    PLANNING_MAIN_PROMPT_GOAL_ACTION:
      "planningMainPromptGoalAction",
    PLANNING_MAIN_PROMPT_GOAL_TEXT:
      "planningMainPromptGoalText",
    PLANNING_MAIN_USER_GOAL_HEADER: "planningMainUserGoalHeader",
    PLANNING_MAIN_CURRENT_TASK_GOAL_PROTOCOL: "planningMainCurrentTaskGoalProtocol",
    PLANNING_MAIN_CONSTRAINT: "planningMainConstraint",
    PLANNING_MAIN_EXAMPLE_HEADER: "planningMainExampleHeader",
    PLANNING_MAIN_EXAMPLE_ADD: "planningMainExampleAdd",
    PLANNING_EMPTY_TEXT: "planningEmptyText",
    PLANNING_REVISION_CURRENT_PLAN_LABEL: "planningRevisionCurrentPlanLabel",
    PLANNING_REVISION_PROMPT_GOAL: "planningRevisionPromptGoal",
    PLANNING_REVISION_STATUS_HEADER: "planningRevisionStatusHeader",
    PLANNING_REVISION_COUNT_LINE: "planningRevisionCountLine",
    PLANNING_REVISION_CONSTRAINT: "planningRevisionConstraint",
    PLANNING_REVISION_EXAMPLE_HEADER: "planningRevisionExampleHeader",
    PLANNING_REVISION_EXAMPLE_UPDATE: "planningRevisionExampleUpdate",
    PLANNING_REVISION_EXAMPLE_ADD: "planningRevisionExampleAdd",
    PLANNING_REFINEMENT_PROMPT_GOAL: "planningRefinementPromptGoal",
    PLANNING_REFINEMENT_TARGETS_HEADER: "planningRefinementTargetsHeader",
    PLANNING_REFINEMENT_TARGET_IDS_HEADER: "planningRefinementTargetIdsHeader",
    PLANNING_REFINEMENT_TARGET_ONLY_CONSTRAINT: "planningRefinementTargetOnlyConstraint",
    PLANNING_REFINEMENT_EXISTING_SUBSTEPS_LABEL: "planningRefinementExistingSubstepsLabel",
    PLANNING_REFINEMENT_EXAMPLE_HEADER: "planningRefinementExampleHeader",
    PLANNING_REFINEMENT_EXAMPLE_ADD: "planningRefinementExampleAdd",
    PLANNING_REFINEMENT_EXAMPLE_UPDATE: "planningRefinementExampleUpdate",
    GUIDANCE_SUMMARY_PROMPT_GOAL: "guidanceSummaryPromptGoal",
    GUIDANCE_SUMMARY_PROTOCOL_HINT: "guidanceSummaryProtocolHint",
    GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH: "guidanceSummarySampleRiskHigh",
    GUIDANCE_SUMMARY_SAMPLE_RISK_HIGH_PROGRAMMING: "guidanceSummarySampleRiskHighProgramming",
    GUIDANCE_SUMMARY_PROGRAMMING_RULES: "guidanceSummaryProgrammingRules",
    GUIDANCE_SUMMARY_TEXT_SCENARIO_RULES: "guidanceSummaryTextScenarioRules",
    GUIDANCE_SUMMARY_TEXT_OVERVIEW_SAMPLE: "guidanceSummaryTextOverviewSample",
    GUIDANCE_SUMMARY_TEXT_RISK_SAMPLE: "guidanceSummaryTextRiskSample",
    GUIDANCE_SUMMARY_DETAIL_HEADER: "guidanceSummaryDetailHeader",
    GUIDANCE_SUMMARY_DETAIL_SAMPLE: "guidanceSummaryDetailSample",
    GUIDANCE_SUMMARY_NEXT_SUGGESTION_SAMPLE: "guidanceSummaryNextSuggestionSample",
    GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_SAMPLE: "guidanceSummaryProgrammingNextActionSample",
    GUIDANCE_SUMMARY_PROGRAMMING_NEXT_ACTION_RULES: "guidanceSummaryProgrammingNextActionRules",
    GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_SAMPLE: "guidanceSummaryActionNextActionSample",
    GUIDANCE_SUMMARY_ACTION_NEXT_ACTION_RULES: "guidanceSummaryActionNextActionRules",
    GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_SAMPLE: "guidanceSummaryTextNextActionSample",
    GUIDANCE_SUMMARY_TEXT_NEXT_ACTION_RULES: "guidanceSummaryTextNextActionRules",
    GUIDANCE_SUMMARY_RULES: "guidanceSummaryRules",
    PREVIOUS_SUMMARY_CONTEXT_HEADER: "previousSummaryContextHeader",
    ACCEPTANCE_MAIN_PLAN_CONTEXT_HEADER: "acceptanceMainPlanContextHeader",
    PHASE_ACCEPTANCE_REQUEST_GOAL: "phaseAcceptanceRequestGoal",
    PHASE_ACCEPTANCE_REQUEST_CONSTRAINT: "phaseAcceptanceRequestConstraint",
    PHASE_ACCEPTANCE_CHECKLIST_TITLE: "phaseAcceptanceChecklistTitle",
    SUMMARY_CHECKLIST_TITLE: "summaryChecklistTitle",
    FINAL_ACCEPTANCE_REQUEST_GOAL: "finalAcceptanceRequestGoal",
    PLAN_CHECKLIST_CONTEXT_HEADER: "planChecklistContextHeader",
    PLAN_CHECKLIST_CURRENT_TASK_GOAL_HEADER: "planChecklistCurrentTaskGoalHeader",
    PLAN_CHECKLIST_TASKS_HEADER: "planChecklistTasksHeader",
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
    PROTOCOL_SUMMARY_TITLE: "protocolSummaryTitle",
    PROTOCOL_SUMMARY_SYNTAX_HEADER: "protocolSummarySyntaxHeader",
    PROTOCOL_SUMMARY_GENERAL_ADD_COMMAND: "protocolSummaryGeneralAddCommand",
    PROTOCOL_SUMMARY_GENERAL_UPDATE_COMMAND: "protocolSummaryGeneralUpdateCommand",
    PROTOCOL_SUMMARY_DELETE_COMMAND: "protocolSummaryDeleteCommand",
    PROTOCOL_SUMMARY_GENERAL_RULES: "protocolSummaryGeneralRules",
    PROTOCOL_SUMMARY_PROGRAMMING_ADD_COMMAND: "protocolSummaryProgrammingAddCommand",
    PROTOCOL_SUMMARY_PROGRAMMING_UPDATE_COMMAND: "protocolSummaryProgrammingUpdateCommand",
    PROTOCOL_SUMMARY_TEXT_ADD_COMMAND: "protocolSummaryTextAddCommand",
    PROTOCOL_SUMMARY_TEXT_UPDATE_COMMAND: "protocolSummaryTextUpdateCommand",
    PROTOCOL_SUMMARY_TEXT_RULES: "protocolSummaryTextRules",
    PROTOCOL_SUMMARY_PROGRAMMING_RULES: "protocolSummaryProgrammingRules",
    PROTOCOL_SUMMARY_ACTION_RULES: "protocolSummaryActionRules",
    PROTOCOL_SUMMARY_TEXT_DELIVERY_RULES:
      "protocolSummaryTextDeliveryRules",
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
    TARGET_MAIN_STEP_INDEXES_DESCRIPTION: "planRefinementTargetMainStepIndexesDescription",
    NOT_READY_REASON: "planRefinementNotReadyReason",
    CONVERGED_REASON: "planRefinementConvergedReason",
    FAILED_REASON: "planRefinementFailedReason",
  }),
  CHECKLIST: Object.freeze({
    TASK_DEFAULT_NAME_TEMPLATE: "checklistTaskDefaultNameTemplate",
  }),
  SYSTEM_PROMPT: Object.freeze({
    POLICY_GENERAL: "harnessPolicyGeneralPrompt",
    POLICY_TEXT: "harnessPolicyTextPrompt",
    POLICY_PROGRAMMING: "harnessPolicyProgrammingPrompt",
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
    harnessPolicyGeneralPrompt:
      "Noobot Harness 通用策略：遵守用户隔离；附件先转文本再处理；未知规则、模板、路径、配置先读后用；先读必要上下文，做最小切片可逆动作；循环执行 -> 验证/反馈 -> 修正 -> 继续，不断推进任务。验证是完成条件：优先跑相关测试/检查/构建，失败先修复重试；无法验证必须说明原因。仅在不可逆/破坏性、安全隐私、生产/资金、高成本外部动作或需求冲突时停下确认。最终回复简洁说明结果与验证。",
    harnessPolicyTextPrompt:
      "Noobot Harness 文本场景策略：遵守用户隔离；复杂任务必须先分文件，按文件拆成交付单元，逐文件产出与维护，禁止把完整内容一次写进单个文件或单次回复；边查/边搜/边核对，边写/边产出，不等资料全部收集完才开始产出；建议每轮推进一个可交付单元，如文件、章节、表格、摘要、清单、对比或阶段稿，并标明来源、假设或待核对项；外部文本到手先保真消费并保留来源路径、事实、约束、依据和可复用片段；每批检查来源、覆盖、关键事实和格式。",
    harnessPolicyProgrammingPrompt:
      "Noobot Harness 编程场景策略：遵守用户隔离；先读必要代码、配置、测试和上下文，做最小切片可逆动作；循环执行 -> 验证/反馈 -> 修正 -> 继续，不断推进任务。验证是完成条件：优先运行相关测试、lint、类型检查或构建；失败先按错误修复并重试；只有不可逆/破坏性、安全凭证、生产数据、生产发布或需求冲突时停下确认。最终回复简洁说明改动文件与验证。",
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
    acceptanceCompletePlanChecklistLabel: "完整计划清单",
    acceptanceLatestCompleteSummaryTitle: "## 最后一次完整小结",
    acceptanceCollapseAcceptanceTitle: "Harness-验收",
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
    planningDefaultPlanText:
      "1. 需求澄清与约束确认\n2. 实施并验证核心改动\n3. 最终验收与交付",
    postPlanFollowupPlanning:
      "计划已完成。建议调用工具按计划推进；复杂任务建议不要试图一次完成，可按计划分批推进；具体推进方式遵守系统场景策略。",
    postPlanFollowupRevision:
      "计划修正已完成。建议调用工具按计划推进；复杂任务建议不要试图一次完成，可按计划分批推进；具体推进方式遵守系统场景策略。",
    postPlanFollowupRefinement:
      "计划细化已完成。建议调用工具按计划推进；复杂任务建议不要试图一次完成，可按计划分批推进；具体推进方式遵守系统场景策略。",
    responsibilityStagePlanning: "规划",
    responsibilityStageRevision: "计划修正",
    responsibilityStageRefinement: "计划细化",
    responsibilityStageSummary: "小结",
    responsibilityStagePhaseAcceptance: "阶段验收",
    responsibilityStageFinalAcceptance: "总体验收",
    responsibilityConstraintTemplate:
      "职责约束：你当前仅负责「{stage}」。只做该职责范围内的事，禁止越权。",
    responsibilityScenarioMismatchProtocol:
      "如果初始场景与当前用户实际意图不匹配，必须在本次输出中追加且只追加一个 [{block}] 文本协议块，返回当前实际场景；scenario 使用 general|text|programming，reason 简述不匹配原因，prompt 写当前实际场景对应的简洁处理策略。协议格式：\n[{block}]\nscenario = general|text|programming\nreason = 初始场景与当前实际意图不匹配\nprompt:\n<当前实际场景对应的处理策略>\n[/{block}]",
    scenarioPolicyGeneral: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.ZH_CN].general,
    scenarioPolicyText: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.ZH_CN].text,
    scenarioPolicyProgramming: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.ZH_CN].programming,
    guidanceFailurePromptTemplate:
      "工具失败达到阈值({reason})，请分析工具失败原因，并且给予修复建议。",
    dynamicPolicyPromptProtocolInstruction:
      "可选动态策略提示词协议：\n请根据用户实际意图判断是否需要调整处理风格；只有当前任务需要比默认矩阵更合适的场景策略时，才追加且只追加一个 [{block}] 块；否则不要输出该块。scenario 必须符合用户实际意图。\n该 prompt 只描述处理事情的风格/执行策略，不要涉及具体任务本身、任务结论、计划项、文件名或业务内容；尽量简洁，并且可直接作为后续主流程、followup 与 harness 辅助调用的统一场景策略块使用。\n[{block}]\nscenario = general|text|programming\nreason = short reason\nprompt:\n<用于替换默认场景提示词的策略提示词>\n[/{block}]\n文本示例：\n[{block}]\nscenario = text\nreason = task-specific text delivery policy\nprompt:\n文本场景动态策略：复杂任务必须先分文件，按文件拆成交付单元，逐文件产出与维护，禁止把完整内容一次写进单个文件或单次回复；边查/边搜/边核对，边写/边产出，不等资料全部收集完才开始产出；建议每轮推进一个可交付单元，如文件、章节、表格、摘要、清单、对比或阶段稿，并标明来源、假设或待核对项；外部文本到手先保真消费并保留来源；每批检查事实、来源和格式。\n[/{block}]\n编程示例：\n[{block}]\nscenario = programming\nreason = task-specific coding verification policy\nprompt:\n编程场景动态策略：先读取相关代码、配置、测试和上下文，做最小切片可逆动作；循环执行 -> 验证/反馈 -> 修正 -> 继续，不断推进任务；验证是完成条件，优先运行相关测试、lint、类型检查或构建，失败先按反馈修正并重试；最终说明改动文件与验证结果。\n[/{block}]",
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
    planningMainPromptGoalProgrammingFast:
      "目标：生成用于编程场景的可执行计划。计划项应包含明确目标、关键对象、必要验证或检查方式；具体推进方式遵守系统场景策略。",
    planningMainPromptGoalAction:
      "目标：生成适用于通用场景的可执行计划。计划项应包含明确目标、关键对象、必要验证或检查方式；具体推进方式遵守系统场景策略。",
    planningMainPromptGoalText:
      "目标：生成面向文本场景的可交付批次计划。每个批次应能形成可直接使用的文本产物或阶段结果，并包含必要的来源、覆盖或格式检查；具体推进方式遵守系统场景策略。",
    planningMainUserGoalHeader: "【用户目标】",
    planningMainCurrentTaskGoalProtocol:
      "在计划 patch 行之前，必须用以下文本协议输出当前任务目标：[CURRENT_TASK_GOAL]\\n<由计划模型提炼的一句话当前任务目标>\\n[PLAN]",
    planningMainConstraint:
      "约束：主计划ID 必须是数字（仅阿拉伯数字）。",
    planningMainExampleHeader: "【输出示例】",
    planningMainExampleAdd: "ADD [主计划ID] [主计划内容]",
    planningRevisionPromptGoal:
      "目标：基于当前上下文与计划清单修正宏观主计划。仅限操作主计划ID，严禁涉及子计划。",
    planningRevisionStatusHeader: "【当前状态】",
    planningRevisionCountLine:
      "已修正次数：{revisionCount}/{maxAttempts}",
    planningRevisionCurrentPlanLabel: "当前主计划：",
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
    guidanceSummarySampleRiskHighProgramming:
      "2. [plan=8][status=todo][risk=高][evidence=...][file=src/example.js][method=handleRequest][line=10-20,35,48-52] ...",
    guidanceSummaryProgrammingRules:
      "编程场景附加要求：涉及具体代码位置、文件变更、测试失败定位、错误堆栈或日志定位时，必须包含 file、method、line；没有可靠代码位置时使用 file=- method=- line=-，禁止编造文件、函数或行号；line 只有上下文存在明确行号时填写，否则使用 line=-。",
    guidanceSummaryTextScenarioRules:
      "文本场景附加建议：外部文本信息一旦出现在用户输入、附件、工具结果、文件或其他来源中，建议在本轮优先消费并沉淀，降低后续上下文裁剪导致丢失的风险；SUMMARY_OVERVIEW 的每条相关小结建议包含 path（文件路径或 -）与 text（关键文本内容/原文片段/结论），SUMMARY_DETAIL 保留可追溯证据。",
    guidanceSummaryTextOverviewSample:
      "1. [plan=2][status=done][evidence=...][file=-][line=-][path=docs/input.txt][text=关键文本片段/结论] ...",
    guidanceSummaryTextRiskSample:
      "2. [plan=8][status=todo][risk=高][evidence=...][file=-][line=-][path=docs/risk.txt][text=风险相关文本片段] ...",
    guidanceSummaryDetailHeader: "## 详细明细",
    guidanceSummaryDetailSample: "- 证据/日志/风险分析 ...",
    guidanceSummaryNextSuggestionSample:
      "- 下一步优先执行最高优先级的未完成/风险计划项，并给出可验证动作。",
    guidanceSummaryProgrammingNextActionSample:
      "[NEXT_ACTION]\naction = edit|test|inspect|ask_user|final\ntarget = 文件路径/命令/问题\nreason = 简短原因\nblocking = true|false",
    guidanceSummaryProgrammingNextActionRules:
      "编程场景的 [NEXT_EXECUTION_SUGGESTION] 必须且只允许输出 1 个 [NEXT_ACTION] 文本块；action 只能是 edit、test、inspect、ask_user、final 之一；target 必须是具体文件路径、命令或需要询问用户的问题；reason 必须简短；blocking 根据统一场景策略填写 true|false。",
    guidanceSummaryActionNextActionSample:
      "[NEXT_ACTION]\naction = do|verify|inspect|ask_user|final\ntarget = 对象/动作/问题\niteration_mode = smallest_slice_loop\nnext_slice = 下一最小切片\nlast_check = 最近验证/检查|-\nresult_state = done|needs_fix|blocked|unknown\nartifact_path = 产物/代码路径|-\nvalidation_cmd = 验证命令|-\nfallback_check = 替代检查|-\nreason = 简短原因\nblocking = true|false",
    guidanceSummaryActionNextActionRules:
      "通用场景的 [NEXT_EXECUTION_SUGGESTION] 必须且只允许输出 1 个 [NEXT_ACTION] 文本块；action 只能是 do、verify、inspect、ask_user、final 之一；target 必须是具体对象、动作或需要询问用户的问题；iteration_mode、next_slice、last_check、result_state、artifact_path、validation_cmd、fallback_check 按字段含义填写；reason 必须简短；blocking 根据统一场景策略填写 true|false。",
    guidanceSummaryTextNextActionSample:
      "[NEXT_ACTION]\naction = consume|extract|draft|expand|revise|verify|ask_user|final\ntarget = 文本来源/产物/处理对象/问题\nbatch_mode = deliverable_text_batch\nbatch_scope = 本轮可交付文本批次\noutput_goal = 本轮要产出的内容\ncoverage_check = 来源覆盖/关键事实/格式检查|-\nresult_state = done|needs_more_text|needs_fix|blocked|unknown\nartifact_path = 产物路径|-\nreason = 简短原因\nblocking = true|false",
    guidanceSummaryTextNextActionRules:
      "文本场景的 [NEXT_EXECUTION_SUGGESTION] 必须且只允许输出 1 个 [NEXT_ACTION] 文本块；action 只能是 consume、extract、draft、expand、revise、verify、ask_user、final 之一；target、batch_mode、batch_scope、output_goal、coverage_check、result_state、artifact_path、reason 按字段含义填写；blocking 根据统一场景策略填写 true|false。",
    guidanceSummaryRules:
      "要求：必须参考 system 中的【当前完整计划清单】作为当前完整计划，并参考【上一次小结】（若存在）累积更新；本轮小结必须整合上一轮小结结果：仍有效的已完成事项、进行中事项、风险、待办和证据都要保留或更新，不得遗漏；已失效/已解决的旧条目必须说明状态变化、更新原因或删除原因；本轮小结要基于上一轮小结、详细信息和当前完整计划清单生成；SUMMARY_OVERVIEW 保持简短、面向主流程决策；每条小结必须包含 plan 与 evidence，evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；用 [status=todo] 输出待处理风险点（写清影响与建议缓解动作）；SUMMARY_DETAIL 写充分细节；SUMMARY_DETAIL 后必须输出 [NEXT_EXECUTION_SUGGESTION]，集中给出下一步可执行建议。",
    previousSummaryContextHeader: "【上一次小结】",
    checklistTaskDefaultNameTemplate: "任务 {index}",
    planChecklistContextHeader: "【当前完整计划清单】",
    planChecklistCurrentTaskGoalHeader: "【当前任务目标】",
    planChecklistTasksHeader: "【任务清单】",
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
    protocolSummaryTitle: "建议使用 summary_patch_v1（与计划 patch 协议独立）。",
    protocolSummarySyntaxHeader: "语法：",
    protocolSummaryGeneralAddCommand:
      "ADD S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] line=[行号/行号范围|-] [小结内容]",
    protocolSummaryGeneralUpdateCommand:
      "UPDATE S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] line=[行号/行号范围|-] [小结内容]",
    protocolSummaryDeleteCommand: "DELETE S[小结ID]",
    protocolSummaryGeneralRules:
      "必须对齐当前完整计划清单；必须整合上一轮小结结果，不得遗漏仍有效的旧条目；已失效/已解决的旧条目必须说明状态变化、更新原因或删除原因；evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；若使用 summary_text_v2，必须在 SUMMARY_DETAIL 后追加 [NEXT_EXECUTION_SUGGESTION] 集中给出下一步执行建议。若无法按协议输出，返回非空文本也可，但仍需写明计划ID、状态、证据、file、line、下一步执行建议与问题说明；没有位置时使用 file=- line=-。",
    protocolSummaryProgrammingAddCommand:
      "ADD S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] method=[方法/函数名|-] line=[行号/行号范围|-，可多段逗号分隔] [小结内容]",
    protocolSummaryProgrammingUpdateCommand:
      "UPDATE S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] method=[方法/函数名|-] line=[行号/行号范围|-，可多段逗号分隔] [小结内容]",
    protocolSummaryTextAddCommand:
      "ADD S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] line=[行号/行号范围|-] path=[文件路径|-] text=[关键文本内容/原文片段/结论] [小结内容]",
    protocolSummaryTextUpdateCommand:
      "UPDATE S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] evidence=[简短证据] file=[文件路径|-] line=[行号/行号范围|-] path=[文件路径|-] text=[关键文本内容/原文片段/结论] [小结内容]",
    protocolSummaryTextRules:
      "文本场景建议把已获得的外部文本优先消费并沉淀；SUMMARY_OVERVIEW 每条相关小结保持 file、line、path 与 text 字段完整；file/line 没有位置时用 -，path 写来源文件路径或 -，text 写关键文本内容/原文片段/结论；SUMMARY_DETAIL 写来源、处理依据、保留/删除原因和风险，降低外部文本因上下文裁剪丢失的风险。",
    protocolSummaryProgrammingRules:
      "编程场景必须对齐当前完整计划清单；必须整合上一轮小结结果，不得遗漏仍有效的旧条目；已失效/已解决的旧条目必须说明状态变化、更新原因或删除原因；evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；若使用 summary_text_v2，必须在 SUMMARY_DETAIL 后追加 [NEXT_EXECUTION_SUGGESTION]，其中必须且只允许包含 1 个 [NEXT_ACTION] 文本块（action=edit|test|inspect|ask_user|final，target=文件路径/命令/问题，reason=简短原因，blocking=true|false）；涉及具体代码位置、文件变更、测试失败定位、错误堆栈或日志定位时必须写明 file、method、line；没有可靠代码位置时使用 file=- method=- line=-；line 只有上下文存在明确行号时填写，否则使用 line=-；禁止编造文件、函数或行号。若无法按协议输出，返回非空文本也可，但仍需写明计划ID、状态、证据、唯一下一步动作、文件、方法、行号或 - 与问题说明。",
    protocolSummaryActionRules:
      "通用场景必须对齐当前完整计划清单；必须整合上一轮小结结果，不得遗漏仍有效的旧条目；已失效/已解决的旧条目必须说明状态变化、更新原因或删除原因；evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；若使用 summary_text_v2，必须在 SUMMARY_DETAIL 后追加 [NEXT_EXECUTION_SUGGESTION]，其中必须且只允许包含 1 个 [NEXT_ACTION] 文本块（action=do|verify|inspect|ask_user|final，target=对象/动作/问题，iteration_mode=smallest_slice_loop，next_slice=下一最小切片，last_check=最近验证/检查|-，result_state=done|needs_fix|blocked|unknown，artifact_path=产物/代码路径|-，validation_cmd=验证命令|-，fallback_check=替代检查|-，reason=简短原因，blocking=true|false）。若无法按协议输出，返回非空文本也可，但仍需写明计划ID、状态、证据、唯一下一步动作、循环字段、可选编程字段与问题说明；没有位置时使用 file=- line=-。",
    protocolSummaryTextDeliveryRules:
      "文本场景必须对齐当前完整计划清单；必须整合上一轮小结结果，不得遗漏仍有效的旧条目；已失效/已解决的旧条目必须说明状态变化、更新原因或删除原因；evidence 必须来自上下文、工具结果或模型最终输出，禁止编造；若使用 summary_text_v2，必须在 SUMMARY_DETAIL 后追加 [NEXT_EXECUTION_SUGGESTION]，其中必须且只允许包含 1 个 [NEXT_ACTION] 文本块（action=consume|extract|draft|expand|revise|verify|ask_user|final，target=文本来源/产物/处理对象/问题，batch_mode=deliverable_text_batch，batch_scope=本轮可交付文本批次，output_goal=本轮要产出的内容，coverage_check=来源覆盖/关键事实/格式检查|-，result_state=done|needs_more_text|needs_fix|blocked|unknown，artifact_path=产物路径|-，reason=简短原因，blocking=true|false）。若无法按协议输出，返回非空文本也可，但仍需写明计划ID、状态、证据、唯一下一步动作、批次字段、产物路径或 - 与问题说明。",
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
    harnessPolicyGeneralPrompt:
      "Noobot Harness general policy: enforce user isolation; convert attachments to text before processing; read unknown rules/templates/paths/configuration before use; read necessary context, then take the smallest reversible action; loop execute -> verify/observe -> fix -> continue. Verification is required for completion: prefer relevant tests/checks/builds; fix failures and retry, or state why verification was impossible. Stop for confirmation only for irreversible/destructive, security/privacy, production/money, costly external actions, or requirement conflicts. Final response: concise result and validation.",
    harnessPolicyTextPrompt:
      "Noobot Harness text-scenario policy: enforce user isolation; complex tasks must be split into files first; make each file a deliverable unit and produce/maintain files one by one; do not put the full content into one file or one response; search/check while writing and producing instead of waiting until all material is collected; it is recommended to advance one deliverable unit each turn, such as a file, section, table, summary, checklist, comparison, or stage draft, and mark sources, assumptions, or items to verify; faithfully consume external text and preserve source paths, facts, constraints, evidence, and reusable snippets; check sources, coverage, key facts, and format for each batch.",
    harnessPolicyProgrammingPrompt:
      "Noobot Harness programming-scenario policy: enforce user isolation; read necessary code, configuration, tests, and context, then take the smallest-slice reversible action; loop execute -> verify/feedback -> fix -> continue, continuously advancing the task. Verification is required for completion: prefer targeted tests, lint, type checks, or builds; fix failures and retry. Stop for confirmation only for irreversible/destructive operations, security credentials, production data, production release, or requirement conflicts. Final response: concise changed files and validation.",
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
    acceptanceCompletePlanChecklistLabel: "Complete plan checklist",
    acceptanceLatestCompleteSummaryTitle: "## Latest complete summary",
    acceptanceCollapseAcceptanceTitle: "Harness-Acceptance",
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
    planningDefaultPlanText:
      "1. Clarify requirements and constraints\n2. Implement and verify core changes\n3. Final acceptance and delivery",
    postPlanFollowupPlanning:
      "Plan is ready. Prefer continuing with tools in plan order; for complex tasks, avoid trying to finish everything in one pass and proceed in planned batches; follow the unified scenario policy below for how to proceed.",
    postPlanFollowupRevision:
      "Plan revision is done. Prefer continuing with tools in plan order; for complex tasks, avoid trying to finish everything in one pass and proceed in planned batches; follow the unified scenario policy below for how to proceed.",
    postPlanFollowupRefinement:
      "Plan refinement is done. Prefer continuing with tools in plan order; for complex tasks, avoid trying to finish everything in one pass and proceed in planned batches; follow the unified scenario policy below for how to proceed.",
    responsibilityStagePlanning: "planning",
    responsibilityStageRevision: "plan revision",
    responsibilityStageRefinement: "plan refinement",
    responsibilityStageSummary: "summary",
    responsibilityStagePhaseAcceptance: "phase acceptance",
    responsibilityStageFinalAcceptance: "final acceptance",
    responsibilityConstraintTemplate:
      "Responsibility constraint: You are only responsible for {stage}. Do only this scope; do not perform out-of-scope tasks.",
    responsibilityScenarioMismatchProtocol:
      "If the initial scenario does not match the user's current actual intent, append exactly one [{block}] text-protocol block in this output to return the current actual scenario. Use scenario=general|text|programming; reason briefly explains the mismatch; prompt contains the concise handling policy for the current actual scenario. Protocol format:\n[{block}]\nscenario = general|text|programming\nreason = initial scenario does not match current actual intent\nprompt:\n<handling policy for the current actual scenario>\n[/{block}]",
    scenarioPolicyGeneral: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.EN_US].general,
    scenarioPolicyText: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.EN_US].text,
    scenarioPolicyProgramming: HARNESS_DEFAULT_SCENARIO_POLICY_TEXTS[LOCALE.EN_US].programming,
    guidanceFailurePromptTemplate:
      "Guidance triggered by tool failure threshold ({reason}). Please analyze the causes of tool failures and provide suggestions for fixes.",
    dynamicPolicyPromptProtocolInstruction:
      "Optional dynamic policy prompt protocol:\nJudge from the user's actual intent whether the handling style should be adjusted. Only if the current task needs a more suitable scenario policy than the default matrix, append exactly one [{block}] block; otherwise omit it. scenario must match the user's actual intent.\nThe prompt should describe only the handling style/execution policy, not the concrete task, task conclusions, plan items, file names, or business content. Keep it concise and directly usable as the unified scenario policy block for the main flow, followups, and auxiliary harness calls.\n[{block}]\nscenario = general|text|programming\nreason = short reason\nprompt:\n<policy prompt replacing the default scenario prompt>\n[/{block}]\nText example:\n[{block}]\nscenario = text\nreason = task-specific text delivery policy\nprompt:\nText-scenario dynamic policy: complex tasks must be split into files first; make each file a deliverable unit and produce/maintain files one by one; do not put the full content into one file or one response; search/check while writing and producing instead of waiting until all material is collected; it is recommended to advance one deliverable unit each turn, such as a file, section, table, summary, checklist, comparison, or stage draft, and mark sources, assumptions, or items to verify; faithfully consume external text and preserve sources; check facts, sources, and format for each batch.\n[/{block}]\nProgramming example:\n[{block}]\nscenario = programming\nreason = task-specific coding verification policy\nprompt:\nProgramming-scenario dynamic policy: read relevant code, configuration, tests, and context, then take the smallest-slice reversible action; loop execute -> verify/feedback -> fix -> continue, continuously advancing the task; verification is required for completion, so prefer relevant tests, lint, type checks, or builds, fix failures based on feedback, and retry; final response must state changed files and verification results.\n[/{block}]",
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
    planningMainPromptGoalProgrammingFast:
      "Goal: generate an executable plan for programming scenarios. Each plan item should include a clear target, key object, and necessary verification or inspection; follow the unified scenario policy below for execution style.",
    planningMainPromptGoalAction:
      "Goal: generate an executable plan for general scenarios. Each plan item should include a clear target, key object, and necessary verification or inspection; follow the unified scenario policy below for execution style.",
    planningMainPromptGoalText:
      "Goal: generate a deliverable-batch plan for text scenarios. Each batch should produce directly usable text artifacts or stage results and include necessary source, coverage, or format checks; follow the unified scenario policy below for delivery style.",
    planningMainUserGoalHeader: "[User Goal]",
    planningMainCurrentTaskGoalProtocol:
      "Before plan patch lines, output the current task goal using this text protocol: [CURRENT_TASK_GOAL]\\n<one concise current task goal synthesized by the planning model>\\n[PLAN]",
    planningMainConstraint:
      "Constraint: main_plan_id must be numeric (Arabic digits only).",
    planningMainExampleHeader: "[Example]",
    planningMainExampleAdd:
      "ADD [main_plan_id] [main plan content]",
    planningRevisionPromptGoal:
      "Goal: Revise the high-level main plan based on the current context and plan checklist. Only operate on main_plan_id; do not include sub-steps.",
    planningRevisionStatusHeader: "[Current Status]",
    planningRevisionCountLine:
      "Revision count: {revisionCount}/{maxAttempts}",
    planningRevisionCurrentPlanLabel: "Current main plan:",
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
    planningRefinementExampleHeader: "",
    planningRefinementExampleAdd: "",
    planningRefinementExampleUpdate: "",
    guidanceSummaryPromptGoal:
      "Provide a guidance summary of completed items and risks.",
    guidanceSummaryProtocolHint:
      "Use plain-text summary_text_v2 blocks:",
    guidanceSummarySampleRiskHigh:
      "2. [plan=8][status=todo][risk=high][evidence=...] ...",
    guidanceSummarySampleRiskHighProgramming:
      "2. [plan=8][status=todo][risk=high][evidence=...][file=src/example.js][method=handleRequest][line=10-20,35,48-52] ...",
    guidanceSummaryProgrammingRules:
      "Programming-scenario additional requirement: include file, method, and line when there is a concrete code location, file change, test-failure location, stack trace, or log location; use file=- method=- line=- when no reliable code location exists, and never fabricate file/function/line; fill line only when explicit line numbers exist in context, otherwise use line=-.",
    guidanceSummaryTextScenarioRules:
      "Text-scenario additional suggestion: once external text appears in user input, attachments, tool results, files, or any other source, prefer consuming and persisting it in this turn to reduce later loss from context pruning; each relevant SUMMARY_OVERVIEW item should include path (file path or -) and text (key source text/snippet/conclusion), while SUMMARY_DETAIL keeps traceable evidence.",
    guidanceSummaryTextOverviewSample:
      "1. [plan=2][status=done][evidence=...][file=-][line=-][path=docs/input.txt][text=key source text/conclusion] ...",
    guidanceSummaryTextRiskSample:
      "2. [plan=8][status=todo][risk=high][evidence=...][file=-][line=-][path=docs/risk.txt][text=risk-related source text] ...",
    guidanceSummaryDetailHeader: "## Detailed notes",
    guidanceSummaryDetailSample: "- evidence / logs / risk analysis ...",
    guidanceSummaryNextSuggestionSample:
      "- Next, execute the highest-priority unfinished/risky plan item with concrete verification.",
    guidanceSummaryProgrammingNextActionSample:
      "[NEXT_ACTION]\naction = edit|test|inspect|ask_user|final\ntarget = file path/command/question\nreason = brief reason\nblocking = true|false",
    guidanceSummaryProgrammingNextActionRules:
      "In programming scenarios, [NEXT_EXECUTION_SUGGESTION] must contain exactly one [NEXT_ACTION] text block; action must be one of edit, test, inspect, ask_user, final; target must be a concrete file path, command, or user-facing question; reason must be brief; set blocking=true|false according to the unified scenario policy.",
    guidanceSummaryActionNextActionSample:
      "[NEXT_ACTION]\naction = do|verify|inspect|ask_user|final\ntarget = object/action/question\niteration_mode = smallest_slice_loop\nnext_slice = next smallest slice\nlast_check = latest verification/inspection|-\nresult_state = done|needs_fix|blocked|unknown\nartifact_path = artifact/code path|-\nvalidation_cmd = validation command|-\nfallback_check = fallback check|-\nreason = brief reason\nblocking = true|false",
    guidanceSummaryActionNextActionRules:
      "For general scenarios, [NEXT_EXECUTION_SUGGESTION] must contain exactly one [NEXT_ACTION] text block; action must be one of do, verify, inspect, ask_user, final; target, iteration_mode, next_slice, last_check, result_state, artifact_path, validation_cmd, fallback_check, and reason must follow the field meanings; set blocking=true|false according to the unified scenario policy.",
    guidanceSummaryTextNextActionSample:
      "[NEXT_ACTION]\naction = consume|extract|draft|expand|revise|verify|ask_user|final\ntarget = text source/artifact/object/question\nbatch_mode = deliverable_text_batch\nbatch_scope = current deliverable text batch\noutput_goal = output to produce in this turn\ncoverage_check = source coverage/key facts/format check|-\nresult_state = done|needs_more_text|needs_fix|blocked|unknown\nartifact_path = artifact path|-\nreason = brief reason\nblocking = true|false",
    guidanceSummaryTextNextActionRules:
      "For text scenarios, [NEXT_EXECUTION_SUGGESTION] must contain exactly one [NEXT_ACTION] text block; action must be one of consume, extract, draft, expand, revise, verify, ask_user, final; target, batch_mode, batch_scope, output_goal, coverage_check, result_state, artifact_path, and reason must follow the field meanings; set blocking=true|false according to the unified scenario policy.",
    guidanceSummaryRules:
      "Rules: use the [Current Complete Plan Checklist] system context as the current complete plan, and use [Previous Summary] when present for cumulative updates; this summary must integrate the previous summary results: keep or update all still-valid completed items, in-progress items, risks, todos, and evidence without omissions; for obsolete/resolved previous items, explain the status change, update reason, or deletion reason; produce this summary based on the previous summary, detailed notes, and the current complete plan checklist; SUMMARY_OVERVIEW should be short and action-oriented for main agent context; every summary item must include plan and evidence; evidence must come from context, tool results, or model final output and must not be fabricated; include pending risk points with [status=todo] (plus impact and mitigation hints); SUMMARY_DETAIL contains detailed evidence and can be longer; after SUMMARY_DETAIL, output [NEXT_EXECUTION_SUGGESTION] with centralized actionable next execution suggestions.",
    previousSummaryContextHeader: "[Previous Summary]",
    checklistTaskDefaultNameTemplate: "Task {index}",
    planChecklistContextHeader: "[Current Complete Plan Checklist]",
    planChecklistCurrentTaskGoalHeader: "[Current Task Goal]",
    planChecklistTasksHeader: "[Task Checklist]",
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
    protocolSummaryTitle:
      "Prefer summary_patch_v1 (independent from plan patch protocol).",
    protocolSummarySyntaxHeader: "Syntax:",
    protocolSummaryGeneralAddCommand:
      "ADD S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] line=[line number/range|-] [summary content]",
    protocolSummaryGeneralUpdateCommand:
      "UPDATE S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] line=[line number/range|-] [summary content]",
    protocolSummaryDeleteCommand: "DELETE S[summary_id]",
    protocolSummaryGeneralRules:
      "Align with the current complete plan checklist; integrate the previous summary results and do not omit still-valid previous items; for obsolete/resolved previous items, explain the status change, update reason, or deletion reason; evidence must come from context, tool results, or model final output and must not be fabricated; when using summary_text_v2, append [NEXT_EXECUTION_SUGGESTION] after SUMMARY_DETAIL with centralized next execution suggestions. If protocol cannot be followed, any non-empty text is acceptable, but still include plan ID, status, evidence, file, line, next execution suggestion, and issue notes; use file=- line=- when no location exists.",
    protocolSummaryProgrammingAddCommand:
      "ADD S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] method=[method/function name|-] line=[line number/range|-; comma-separated multi-segments allowed] [summary content]",
    protocolSummaryProgrammingUpdateCommand:
      "UPDATE S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] method=[method/function name|-] line=[line number/range|-; comma-separated multi-segments allowed] [summary content]",
    protocolSummaryTextAddCommand:
      "ADD S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] line=[line number/range|-] path=[file path|-] text=[key source text/snippet/conclusion] [summary content]",
    protocolSummaryTextUpdateCommand:
      "UPDATE S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] evidence=[brief evidence] file=[file path|-] line=[line number/range|-] path=[file path|-] text=[key source text/snippet/conclusion] [summary content]",
    protocolSummaryTextRules:
      "In text scenarios, prefer consuming and persisting obtained external text promptly; keep file, line, path, and text fields complete for every relevant SUMMARY_OVERVIEW item; use file/line as - when no location exists, path as the source file path or -, and text as the key source text/snippet/conclusion; SUMMARY_DETAIL should include source, reasoning, keep/delete reasons, and risks to reduce loss from context pruning.",
    protocolSummaryProgrammingRules:
      "In programming scenarios, align with the current complete plan checklist; integrate the previous summary results and do not omit still-valid previous items; for obsolete/resolved previous items, explain the status change, update reason, or deletion reason; evidence must come from context, tool results, or model final output and must not be fabricated; when using summary_text_v2, append [NEXT_EXECUTION_SUGGESTION] after SUMMARY_DETAIL, and it must contain exactly one [NEXT_ACTION] text block (action=edit|test|inspect|ask_user|final, target=file path/command/question, reason=brief reason, blocking=true|false); include file, method, and line only for concrete code locations, file changes, test-failure locations, stack traces, or log locations; use file=- method=- line=- when no reliable code location exists; fill line only when explicit line numbers exist in context, otherwise use line=-; never fabricate file/function/line. If protocol cannot be followed, any non-empty text is acceptable, but still include plan ID, status, evidence, the single next action, file/method/line or -, and issue notes.",
    protocolSummaryActionRules:
      "For general scenarios, align with the current complete plan checklist; integrate the previous summary results and do not omit still-valid previous items; for obsolete/resolved previous items, explain the status change, update reason, or deletion reason; evidence must come from context, tool results, or model final output and must not be fabricated; when using summary_text_v2, append [NEXT_EXECUTION_SUGGESTION] after SUMMARY_DETAIL, and it must contain exactly one [NEXT_ACTION] text block (action=do|verify|inspect|ask_user|final, target=object/action/question, iteration_mode=smallest_slice_loop, next_slice=next smallest slice, last_check=latest verification/inspection|-, result_state=done|needs_fix|blocked|unknown, artifact_path=artifact/code path|-, validation_cmd=validation command|-, fallback_check=fallback check|-, reason=brief reason, blocking=true|false). If protocol cannot be followed, any non-empty text is acceptable, but still include plan ID, status, evidence, the single next action, loop fields, optional programming fields, and issue notes; use file=- line=- when no location exists.",
    protocolSummaryTextDeliveryRules:
      "For text scenarios, align with the current complete plan checklist; integrate the previous summary results and do not omit still-valid previous items; for obsolete/resolved previous items, explain the status change, update reason, or deletion reason; evidence must come from context, tool results, or model final output and must not be fabricated; when using summary_text_v2, append [NEXT_EXECUTION_SUGGESTION] after SUMMARY_DETAIL, and it must contain exactly one [NEXT_ACTION] text block (action=consume|extract|draft|expand|revise|verify|ask_user|final, target=text source/artifact/object/question, batch_mode=deliverable_text_batch, batch_scope=current deliverable text batch, output_goal=output to produce in this turn, coverage_check=source coverage/key facts/format check|-, result_state=done|needs_more_text|needs_fix|blocked|unknown, artifact_path=artifact path|-, reason=brief reason, blocking=true|false). If protocol cannot be followed, any non-empty text is acceptable, but still include plan ID, status, evidence, the single next action, batch fields, artifact path or -, and issue notes.",
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
