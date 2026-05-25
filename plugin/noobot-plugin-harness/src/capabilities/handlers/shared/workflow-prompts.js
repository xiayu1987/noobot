/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "./constants.js";
import { resolvePlanChecklistText } from "./plan-checklist-context.js";

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
      "[Output Format]",
      "Plain-text list, one item per line.",
      "Format: [Integer ID]. [Main plan content]",
      "Requirement: IDs must start at 1 and increase sequentially.",
      "",
      "[Example]",
      "1. Requirement analysis and technical solution",
      "2. Database schema design",
      "3. Core business logic development",
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：根据用户需求生成宏观主计划。仅限宏观步骤，严禁输出任何子计划或实施细节。",
    "",
    "【用户目标】",
    goal,
    "",
    "【输出格式】",
    "纯文本列表，每行一条。",
    "格式：[整数ID]. [主计划内容]",
    "要求：ID 必须从 1 开始递增。",
    "",
    "【输出示例】",
    "1. 需求分析与技术选型",
    "2. 数据库结构设计",
    "3. 核心业务逻辑开发",
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
      "Goal: Revise the high-level main plan based on latest feedback. Only operate on main plan IDs; do not include sub-steps.",
      "",
      "[Current Status]",
      `Revision count: ${revisionCount}/5`,
      ...currentPlanSection,
      "Latest feedback:",
      latestFeedback,
      "",
      "[ID+PATCH Syntax]",
      "ADD [new integer ID] [main plan content]",
      "UPDATE [existing integer ID] [updated content]",
      "DELETE [existing integer ID]",
    ].filter(Boolean).join("\n");
  }
  const currentPlanSection = includeCurrentMainPlans === false ? [] : ["当前主计划：", mainPlansText];
  return [
    String(marker || "").trim(),
    "目标：基于最新反馈修正宏观主计划。仅限操作主计划（整数ID），严禁涉及子计划。",
    "",
    "【当前状态】",
    `已修正次数：${revisionCount}/5`,
    ...currentPlanSection,
    "最新反馈：",
    latestFeedback,
    "",
    "【ID+PATCH 协议语法】",
    "ADD [新整数ID] [主计划内容]",
    "UPDATE [已有整数ID] [修改后的内容]",
    "DELETE [已有整数ID]",
    "",
    "【输出示例】",
    "UPDATE 2 数据库及缓存架构设计",
    "ADD 4 部署上线",
  ].filter(Boolean).join("\n");
}

export function buildPlanningRefinementPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const targetId = data.targetId ?? options?.targetId ?? 1;
  const targetContent = data.targetContent ?? options?.targetContent ?? "";
  const existingSubPlansText = data.existingSubPlansText ?? options?.existingSubPlansText ?? "";
  const feedback = data.feedback ?? options?.feedback ?? "";
  const id = Number.isFinite(Number(targetId)) ? Number(targetId) : 1;
  const content = String(targetContent || "").trim();
  const subPlans = String(existingSubPlansText || "").trim() || (locale === LOCALE.EN_US ? "(empty)" : "（空）");
  const latestFeedback = String(feedback || "").trim() || (locale === LOCALE.EN_US ? "N/A" : "（无）");
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Decompose and refine the target main plan into executable sub-steps.",
      "",
      "[Current Task]",
      `Target main plan: ID=${id} | Content: ${content}`,
      "Existing sub-steps:",
      subPlans,
      "",
      '[ID+PATCH Syntax] (ID must strictly start with "' + `${id}.` + '")',
      `ADD ${id}.[sub-id] [content]`,
      `UPDATE ${id}.[sub-id] [updated content]`,
      `DELETE ${id}.[sub-id]`,
      "",
      "[Latest Feedback]",
      latestFeedback,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：拆解并细化指定的主计划，生成具体可执行的子步骤。",
    "",
    "【当前任务】",
    `目标主计划：ID=${id} | 内容：${content}`,
    "已有子步骤：",
    subPlans,
    "",
    `【ID+PATCH 协议语法】(ID 必须严格以 "${id}." 开头)`,
    `ADD ${id}.[子序号] [细化内容]`,
    `UPDATE ${id}.[子序号] [修改后的内容]`,
    `DELETE ${id}.[子序号]`,
    "",
    "【最新反馈】",
    latestFeedback,
    "",
    `【输出示例】(假设 target_id=${id})`,
    `ADD ${id}.1 设计核心数据结构`,
    `ADD ${id}.2 编写实现与验证步骤`,
  ].filter(Boolean).join("\n");
}

export function buildGuidanceSummaryPromptText(options = {}) {
  const { locale, marker } = normalizePromptOptions(options);
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Provide a guidance summary of completed items and risks.",
      "Prefer summary_patch_v1 (independent from plan patch protocol).",
      "Syntax:",
      "ADD S[integer] plan=[main_plan_id] status=[done|in_progress|risk|todo] [summary content]",
      "UPDATE S[integer] status=[done|in_progress|risk|todo] [summary content]",
      "DELETE S[integer]",
      "If protocol cannot be followed, any non-empty text is acceptable. Then continue with the task.",
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "请先对已完成内容进行小结（注意是小结，不是总结）。",
    "建议使用 summary_patch_v1（与计划 patch 协议独立）。",
    "语法：",
    "ADD S[整数] plan=[主计划ID] status=[done|in_progress|risk|todo] [小结内容]",
    "UPDATE S[整数] status=[done|in_progress|risk|todo] [小结内容]",
    "DELETE S[整数]",
    "若无法按协议输出，返回非空文本也可。小结后请继续任务，输出已完成项及问题说明。",
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

export function buildAcceptanceValidationRequestPromptText(options = {}) {
  const { locale, marker, data } = normalizePromptOptions(options);
  const payload = data.requestPayload ?? data.payload ?? options?.requestPayload ?? options?.payload ?? null;
  const payloadText = JSON.stringify(payload || {}, null, 2);
  if (locale === LOCALE.EN_US) {
    return [
      String(marker || "").trim(),
      "Goal: Validate acceptance from the system-provided complete main plan context and final output.",
      "Prefer protocol: acceptance_patch_v1 (independent from plan/summary patch protocols).",
      "Syntax:",
      "ADD A[integer] plan=[main_plan_id] status=[pass|warn|fail] [acceptance conclusion]",
      "UPDATE A[integer] status=[pass|warn|fail] [acceptance conclusion]",
      "DELETE A[integer]",
      "Optional fields in line text: evidence=[short evidence], risk=[low|medium|high].",
      "Weak rule: non-empty output is required; if protocol cannot be followed, return non-empty plain text.",
      payloadText,
    ].filter(Boolean).join("\n");
  }
  return [
    String(marker || "").trim(),
    "目标：基于 system 提供的完整主计划上下文与最终输出进行验收。",
    "建议协议：acceptance_patch_v1（与计划/小结 patch 协议独立）。",
    "语法：",
    "ADD A[整数] plan=[主计划ID] status=[pass|warn|fail] [验收结论]",
    "UPDATE A[整数] status=[pass|warn|fail] [验收结论]",
    "DELETE A[整数]",
    "可选字段（写在行文本中）：evidence=[简短证据]、risk=[low|medium|high]。",
    "弱校验规则：仅要求输出非空；若无法严格按协议，返回非空纯文本也可。",
    payloadText,
  ].filter(Boolean).join("\n");
}
