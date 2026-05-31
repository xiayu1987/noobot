/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";
import { resolvePlanChecklistText } from "../plan/checklist-context.js";
import { parseSummaryItemsFromText } from "../plan/summary-text-protocol.js";
import { PLAN_UPDATE_POLICY } from "../../../../core/thresholds.js";
import {
  buildAcceptancePatchProtocolText as buildAcceptancePatchProtocolCoreText,
  buildPlanningMainPatchProtocolText as buildPlanningMainPatchProtocolCoreText,
  buildPlanningRefinementPatchProtocolText as buildPlanningRefinementPatchProtocolCoreText,
  buildPlanningRevisionPatchProtocolText as buildPlanningRevisionPatchProtocolCoreText,
  buildSummaryPatchProtocolText as buildSummaryPatchProtocolCoreText,
} from "./protocols.js";

function normalizePromptOptions(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  return {
    locale: source.locale || LOCALE.ZH_CN,
    marker: String(source.marker || "").trim(),
    data: source.data && typeof source.data === "object" ? source.data : {},
  };
}

export function getPlanningPromptMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-bootstrap -->";
}

export function getPlanningToolContextMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-tools -->";
}

export function getPlanningPromptToolsHeader(locale = LOCALE.ZH_CN) {
  if (locale === LOCALE.EN_US) return "Available tools (name/description), must be referenced:";
  return "可用工具（name/description），规划必须参考：";
}

export function getPlanningContextSummaryHeader(locale = LOCALE.ZH_CN) {
  if (locale === LOCALE.EN_US) return "Planning context summary (compact). Must be fully considered:";
  return "规划输入上下文摘要（精简）如下，必须完整参考：";
}

export function getPlanningSeparateModelEmptyRelay(locale = LOCALE.ZH_CN) {
  return locale === LOCALE.EN_US ? "None" : "无";
}

export function buildPostPlanUserFollowupPrompt(
  locale = LOCALE.ZH_CN,
  stage = "planning",
) {
  const normalizedStage = String(stage || "planning").trim().toLowerCase();
  const isRefinement = normalizedStage.includes("refinement");
  const isRevision = normalizedStage.includes("revision");
  if (locale === LOCALE.EN_US) {
    if (isRefinement) {
      return "Plan refinement is done. Continue the task step by step with tools.";
    }
    if (isRevision) {
      return "Plan revision is done. Continue the task step by step with tools.";
    }
    return "Plan is ready. Continue the task step by step with tools.";
  }
  if (isRefinement) {
    return "计划细化已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。";
  }
  if (isRevision) {
    return "计划修正已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。";
  }
  return "计划已完成。请调用工具，严格按照计划顺序执行任务。每次仅处理一个计划项，完成后基于执行结果再继续下一项，直到全部计划执行完毕。";
}

export function buildWorkflowResponsibilityConstraintUserPrompt(
  locale = LOCALE.ZH_CN,
  stage = "planning",
) {
  const normalizedStage = String(stage || "planning").trim().toLowerCase();
  const stageLabelEn = (() => {
    if (normalizedStage.includes("revision")) return "plan revision";
    if (normalizedStage.includes("refinement")) return "plan refinement";
    if (normalizedStage.includes("summary")) return "summary";
    if (normalizedStage.includes("phase_acceptance")) return "phase acceptance";
    if (
      normalizedStage.includes("acceptance_semantic_validation") ||
      normalizedStage.includes("final_acceptance")
    ) return "final acceptance";
    return "planning";
  })();
  const stageLabelZh = (() => {
    if (normalizedStage.includes("revision")) return "计划修正";
    if (normalizedStage.includes("refinement")) return "计划细化";
    if (normalizedStage.includes("summary")) return "小结";
    if (normalizedStage.includes("phase_acceptance")) return "阶段验收";
    if (
      normalizedStage.includes("acceptance_semantic_validation") ||
      normalizedStage.includes("final_acceptance")
    ) return "总体验收";
    return "规划";
  })();
  if (locale === LOCALE.EN_US) {
    return `Responsibility constraint: You are only responsible for ${stageLabelEn}. Do only this scope; do not perform out-of-scope tasks.`;
  }
  return `职责约束：你当前仅负责「${stageLabelZh}」。只做该职责范围内的事，禁止越权。`;
}

export function getPlanningRevisionMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-revision -->";
}

export function getPlanningRefinementMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-planning-refinement -->";
}

export function getGuidanceSummaryMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-guidance-summary -->";
}

export function getGuidanceMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-guidance -->";
}

export function buildGuidanceFailurePromptText({
  locale = LOCALE.ZH_CN,
  marker = "",
  reason = "",
} = {}) {
  const message = locale === LOCALE.EN_US
    ? `Guidance triggered by tool failure threshold (${String(reason || "").trim()}). Please analyze the causes of tool failures and provide suggestions for fixes.`
    : `工具失败达到阈值(${String(reason || "").trim()})，请分析工具失败原因，并且给予修复建议。`;
  return [String(marker || "").trim(), message].filter(Boolean).join("\n");
}

export function getAcceptanceSemanticValidationMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-acceptance-semantic-validation -->";
}

export function getAcceptanceMainPlanContextMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-acceptance-main-plan -->";
}

export function getPhaseAcceptanceRequestMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-phase-acceptance-request -->";
}

export function getAllPhaseAcceptanceReportsMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-phase-acceptance-reports -->";
}

export function getAllSummaryReportsMarker(locale = LOCALE.ZH_CN) {
  void locale;
  return "<!-- harness-summary-reports -->";
}

export function buildAcceptancePatchProtocolText(options = {}) {
  const { locale, data } = normalizePromptOptions(options);
  const mode = String(data.mode || options?.mode || "final").trim().toLowerCase();
  return buildAcceptancePatchProtocolCoreText({
    locale,
    mode,
  });
}

export function buildPlanningMainPrompt(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const userGoal = String(data.userGoal || options?.userGoal || "").trim();
  const goal = String(userGoal || "").trim() || (locale === LOCALE.EN_US ? "N/A" : "（未获取到用户目标）");
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Generate a high-level main plan from the user goal. Only high-level steps; no sub-steps or implementation details.",
      "",
      "[User Goal]",
      goal,
      "",
      buildPlanningMainPatchProtocolCoreText({ locale, actions: ["ADD"] }),
      "",
      "Constraint: main_plan_id must be numeric (Arabic digits only).",
      "",
      "[Example]",
      "ADD [main_plan_id] [main plan content]",
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：根据用户需求生成宏观主计划。仅限宏观步骤，严禁输出任何子计划或实施细节。",
    "",
    "【用户目标】",
    goal,
    "",
    buildPlanningMainPatchProtocolCoreText({ locale, actions: ["ADD"] }),
    "",
    "约束：主计划ID 必须是数字（仅阿拉伯数字）。",
    "",
    "【输出示例】",
    "ADD [主计划ID] [主计划内容]",
  ].filter(Boolean).join("\n");
}

export function buildPlanningRevisionPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const globalRevisionCount = data.globalRevisionCount ?? options?.globalRevisionCount ?? 0;
  const currentMainPlansText = data.currentMainPlansText ?? options?.currentMainPlansText ?? "";
  const includeCurrentMainPlans = data.includeCurrentMainPlans ?? options?.includeCurrentMainPlans ?? true;
  const feedback = data.feedback ?? options?.feedback ?? "";
  const mainPlansText = String(currentMainPlansText || "").trim() || (locale === LOCALE.EN_US ? "(empty)" : "（空）");
  const latestFeedback = String(feedback || "").trim() || (locale === LOCALE.EN_US ? "N/A" : "（无）");
  const revisionCount = Number.isFinite(Number(globalRevisionCount)) ? Number(globalRevisionCount) : 0;
  if (locale === LOCALE.EN_US) {
    const currentPlanSection = includeCurrentMainPlans === false ? [] : ["Current main plan:", mainPlansText];
    return [
      String(marker || "").trim(),
      "Goal: Revise the high-level main plan based on latest feedback. Only operate on main_plan_id; do not include sub-steps.",
      "",
      "[Current Status]",
      `Revision count: ${revisionCount}/${Number(PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION)}`,
      ...currentPlanSection,
      "Latest feedback:",
      latestFeedback,
      "",
      buildPlanningRevisionPatchProtocolCoreText(locale),
    ].filter(Boolean).join("\n");
  }
  const currentPlanSection = includeCurrentMainPlans === false ? [] : ["当前主计划：", mainPlansText];
  return [
    String(marker || "").trim(),
    "目标：基于最新反馈修正宏观主计划。仅限操作主计划ID，严禁涉及子计划。",
    "",
    "【当前状态】",
    `已修正次数：${revisionCount}/${Number(PLAN_UPDATE_POLICY.MAX_ATTEMPTS_REVISION)}`,
    ...currentPlanSection,
    "最新反馈：",
    latestFeedback,
    "",
    buildPlanningRevisionPatchProtocolCoreText(locale),
    "",
    "约束：主计划ID 必须是数字（仅阿拉伯数字）。",
    "",
    "【输出示例】",
    "UPDATE [主计划ID] [修改后的主计划内容]",
    "ADD [主计划ID] [新增主计划内容]",
  ].filter(Boolean).join("\n");
}

export function buildPlanningRefinementPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const targetIdsRaw = Array.isArray(data.targetIds)
    ? data.targetIds
    : Array.isArray(options?.targetIds)
      ? options.targetIds
      : [];
  const targetIds = targetIdsRaw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  const targetPlansText = data.targetPlansText ?? options?.targetPlansText ?? "";
  const targetId = data.targetId ?? options?.targetId ?? targetIds[0] ?? 1;
  const targetContent = data.targetContent ?? options?.targetContent ?? "";
  const existingSubPlansText = data.existingSubPlansText ?? options?.existingSubPlansText ?? "";
  const feedback = data.feedback ?? options?.feedback ?? "";
  const id = Number.isFinite(Number(targetId)) ? Number(targetId) : 1;
  const content = String(targetContent || "").trim();
  const targetIdListText = targetIds.length ? `[${targetIds.join(",")}]` : `[${id}]`;
  const targetPlans = String(targetPlansText || "").trim() || `${id}. ${content}`.trim();
  const subPlans = String(existingSubPlansText || "").trim() || (locale === LOCALE.EN_US ? "(empty)" : "（空）");
  const latestFeedback = String(feedback || "").trim() || (locale === LOCALE.EN_US ? "N/A" : "（无）");
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Decompose and refine specific target main plans into executable sub-steps.",
      "",
      "[Revised Main Plan Targets]",
      targetPlans || "(empty)",
      "",
      "[Target Main Plan IDs]",
      targetIdListText,
      "",
      "Only refine the target IDs listed above. Do not refine any other main-plan ID.",
      "",
      "Existing sub-steps:",
      subPlans,
      "",
      buildPlanningRefinementPatchProtocolCoreText(locale),
      "",
      "[Latest Feedback]",
      latestFeedback,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：基于修正后的主计划，仅细化指定主计划ID，生成具体可执行的子步骤。",
    "",
    "【修正后的主计划（目标项）】",
    targetPlans || "（空）",
    "",
    "【本次需要细化的主计划ID】",
    targetIdListText,
    "",
    "仅允许细化上述目标ID，禁止输出其他主计划ID下的子计划。",
    "",
    "已有子步骤：",
    subPlans,
    "",
    buildPlanningRefinementPatchProtocolCoreText(locale),
    "",
    "【最新反馈】",
    latestFeedback,
    "",
    "【输出示例】",
    "ADD [主序号.子序号] [抽象子步骤内容A]",
    "UPDATE [主序号.子序号] [抽象子步骤内容B]",
  ].filter(Boolean).join("\n");
}

export function buildGuidanceSummaryPromptText(options = {}) {
  const { locale, marker } = normalizePromptOptions(options);
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Provide a guidance summary of completed items and risks.",
      "Use plain-text summary_text_v2 blocks:",
      "[SUMMARY_OVERVIEW]",
      "1. [plan=2][status=done] ...",
      "2. [plan=8][status=todo][risk=high] ...",
      "[SUMMARY_DETAIL]",
      "## Detailed notes",
      "- evidence / logs / risk analysis ...",
      "[SUMMARY_END]",
      "Rules: SUMMARY_OVERVIEW should be short and action-oriented for main agent context, and must include pending risk points with [status=todo] (plus impact and mitigation hints); SUMMARY_DETAIL contains detailed evidence and can be longer.",
      buildSummaryPatchProtocolCoreText(locale),
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "请先对已完成内容进行小结（注意是小结，不是总结）。",
    "请优先使用纯文本 summary_text_v2 协议：",
    "[SUMMARY_OVERVIEW]",
    "1. [plan=2][status=done] ...",
    "2. [plan=8][status=todo][risk=高] ...",
    "[SUMMARY_DETAIL]",
    "## 详细明细",
    "- 证据/日志/风险分析 ...",
    "[SUMMARY_END]",
    "要求：SUMMARY_OVERVIEW 保持简短、面向主流程决策，并且用 [status=todo] 输出待处理风险点（写清影响与建议缓解动作）；SUMMARY_DETAIL 写充分细节。",
    buildSummaryPatchProtocolCoreText(locale),
  ].filter(Boolean).join("\n");
}

export function buildAcceptanceValidationPromptText(options = {}) {
  return buildAcceptanceValidationRequestPromptText(options);
}

export function buildAcceptanceMainPlanContextPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.mainPlanContext ?? options?.mainPlanContext ?? null;
  const source = payload && typeof payload === "object" ? payload : {};
  const planTextFromPayload = String(source?.planText || "").trim();
  const plansInOrder = Array.isArray(source?.plansInOrder) ? source.plansInOrder : [];
  const checklist = Array.isArray(source?.taskChecklist) ? source.taskChecklist : [];
  const planChecklistText = (() => {
    const mergedPlanTextFromOrderedPlans = plansInOrder
      .map((item = {}) => String(item?.planText || "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    const resolved = resolvePlanChecklistText({
      planText: planTextFromPayload || mergedPlanTextFromOrderedPlans,
      bucket: { taskChecklist: checklist },
    });
    if (resolved) return resolved;
    return locale === LOCALE.EN_US ? "(empty)" : "（空）";
  })();
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Plan checklist context (must be fully respected during acceptance validation):",
      planChecklistText,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "计划清单上下文如下（验收时必须完整对齐）：",
    planChecklistText,
  ].filter(Boolean).join("\n");
}

export function buildPhaseAcceptanceRequestPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? {};
  const payloadText = JSON.stringify(payload || {}, null, 2);
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Perform phase acceptance for the current stage only, based on the preceding context and the system-provided revised plan checklist.",
      buildAcceptancePatchProtocolText({ locale, mode: "phase" }),
      "This is not final acceptance. Do not conclude the whole task is complete unless the context proves it.",
      payloadText,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：基于前面的上下文与 system 提供的计划修正后计划清单，仅进行当前阶段验收。",
    buildAcceptancePatchProtocolText({ locale, mode: "phase" }),
    "这不是总体验收；除非上下文能证明全部完成，否则不要判断整个任务已完成。",
    payloadText,
  ].filter(Boolean).join("\n");
}

export function buildAllPhaseAcceptanceReportsPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reports = Array.isArray(data.phaseAcceptanceReports)
    ? data.phaseAcceptanceReports
    : Array.isArray(options?.phaseAcceptanceReports)
      ? options.phaseAcceptanceReports
      : [];
  const parts = buildAllPhaseAcceptanceReportSystemContents({ locale, marker, data: { phaseAcceptanceReports: reports } });
  return parts.join("\n\n").trim();
}

export function buildAllPhaseAcceptanceReportSystemContents(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const reports = Array.isArray(data.phaseAcceptanceReports)
    ? data.phaseAcceptanceReports
    : Array.isArray(options?.phaseAcceptanceReports)
      ? options.phaseAcceptanceReports
      : [];
  if (!reports.length) return [];
  return reports.map((item = {}, index) => {
    const acceptedAt = String(item?.acceptedAt || item?.timestamp || "").trim();
    const content = String(item?.content || item?.text || "").trim();
    const total = reports.length;
    if (locale === LOCALE.EN_US) {
      return [
        String(marker || "").trim(),
        `Phase acceptance checklist #${index + 1}/${total} (must be considered during final acceptance):`,
        `#${index + 1}${acceptedAt ? ` @ ${acceptedAt}` : ""}`,
        content || "(empty)",
      ].filter(Boolean).join("\n");
    }
    return [
      String(marker || "").trim(),
      `阶段验收清单 #${index + 1}/${total}（总体验收时必须参考）：`,
      `#${index + 1}${acceptedAt ? ` @ ${acceptedAt}` : ""}`,
      content || "（空）",
    ].filter(Boolean).join("\n");
  });
}

export function buildAllSummaryReportSystemContents(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const summaryText = String(data.summaryText ?? options?.summaryText ?? "").trim();
  if (!summaryText) return [];
  const items = parseSummaryItemsFromText(summaryText);
  if (!items.length) {
    if (locale === LOCALE.EN_US) {
      return [
        [
          String(marker || "").trim(),
          "Summary checklist #1/1 (must be considered during phase acceptance):",
          "#1",
          summaryText,
        ].filter(Boolean).join("\n"),
      ];
    }
    return [
      [
        String(marker || "").trim(),
        "小结清单 #1/1（阶段验收时必须参考）：",
        "#1",
        summaryText,
      ].filter(Boolean).join("\n"),
    ];
  }
  return items.map((item = {}, index) => {
    const content = `${Number(item?.id)}. ${String(item?.content || "").trim()}`.trim();
    const total = items.length;
    if (locale === LOCALE.EN_US) {
      return [
        String(marker || "").trim(),
        `Summary checklist #${index + 1}/${total} (must be considered during phase acceptance):`,
        `#${index + 1}`,
        content,
      ].filter(Boolean).join("\n");
    }
    return [
      String(marker || "").trim(),
      `小结清单 #${index + 1}/${total}（阶段验收时必须参考）：`,
      `#${index + 1}`,
      content,
    ].filter(Boolean).join("\n");
  });
}

export function buildAcceptanceValidationRequestPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? null;
  const payloadText = JSON.stringify(payload || {}, null, 2);
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Validate acceptance from the system-provided complete main plan context and final output.",
      buildAcceptancePatchProtocolText({ locale, mode: "final" }),
      payloadText,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：基于 system 提供的完整主计划上下文与最终输出进行验收。",
    buildAcceptancePatchProtocolText({ locale, mode: "final" }),
    payloadText,
  ].filter(Boolean).join("\n");
}
