/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { LOCALE } from "./locale.js";

export const I18N_TOOL_COPY = Object.freeze({
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
    guidanceReasonPendingAnalysis: "存在待处理的分析，优先执行分析",
    guidanceReasonIdle: "无待处理 guidance 动作",
    guidanceBlockedPhaseAcceptanceDeferred: "阶段验收被 guidance 优先级规则延后",
    planningReasonIdle: "规划触发器空闲",
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
    guidanceReasonPendingAnalysis:
      "Pending analysis exists; prioritize analysis first",
    guidanceReasonIdle: "No pending guidance action",
    guidanceBlockedPhaseAcceptanceDeferred:
      "Phase acceptance is deferred by guidance priority order",
    planningReasonIdle: "Planning triggers are idle",
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
