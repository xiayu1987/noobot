/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { LOCALE } from "../constants.js";

function resolveLocale(locale = LOCALE.ZH_CN) {
  return locale === LOCALE.EN_US ? LOCALE.EN_US : LOCALE.ZH_CN;
}

export function buildPlanningRevisionPatchProtocolText(locale = LOCALE.ZH_CN) {
  const normalizedLocale = resolveLocale(locale);
  if (normalizedLocale === LOCALE.EN_US) {
    return [
      "[ID+PATCH Syntax]",
      "ADD [new_main_plan_id] [main plan content]",
      "UPDATE [existing_main_plan_id] [updated content]",
      "DELETE [existing_main_plan_id]",
      "Canonical output style (recommended): ADD [main_plan_id] ... / UPDATE [main_plan_id] ... / DELETE [main_plan_id]",
    ].join("\n");
  }
  return [
    "【ID+PATCH 协议语法】",
    "ADD [新主计划ID] [主计划内容]",
    "UPDATE [已有主计划ID] [修改后的内容]",
    "DELETE [已有主计划ID]",
    "推荐统一输出风格：ADD [主计划ID] ... / UPDATE [主计划ID] ... / DELETE [主计划ID]",
  ].join("\n");
}

export function buildPlanningRefinementPatchProtocolText(locale = LOCALE.ZH_CN) {
  const normalizedLocale = resolveLocale(locale);
  if (normalizedLocale === LOCALE.EN_US) {
    return [
      "[ID+PATCH Syntax] (sub-plan ID format: [main-id.sub-id], and [main-id] must belong to target main plan IDs)",
      "ADD [main-id.sub-id] [content]",
      "UPDATE [main-id.sub-id] [updated content]",
      "DELETE [main-id.sub-id]",
      "Constraint: only one-level sub-plan IDs are allowed. Do not output IDs like 1.1.1.",
      "Canonical output style (recommended): ADD [main-id.sub-id] ... / UPDATE [main-id.sub-id] ... / DELETE [main-id.sub-id] ...",
    ].join("\n");
  }
  return [
    "【ID+PATCH 协议语法】(子计划 ID 格式固定为 [主序号.子序号]，且 [主序号] 必须属于目标主计划 ID 集合)",
    "ADD [主序号.子序号] [细化内容]",
    "UPDATE [主序号.子序号] [修改后的内容]",
    "DELETE [主序号.子序号]",
    "约束：仅允许一级子计划 ID，禁止输出 1.1.1 这类二级子计划 ID。",
    "推荐统一输出风格：ADD [主序号.子序号] ... / UPDATE [主序号.子序号] ... / DELETE [主序号.子序号] ...",
  ].join("\n");
}

export function buildSummaryPatchProtocolText(locale = LOCALE.ZH_CN) {
  const normalizedLocale = resolveLocale(locale);
  if (normalizedLocale === LOCALE.EN_US) {
    return [
      "Prefer summary_patch_v1 (independent from plan patch protocol).",
      "Syntax:",
      "ADD S[summary_id] plan=[main_plan_id] status=[done|in_progress|risk|todo] [summary content]",
      "UPDATE S[summary_id] status=[done|in_progress|risk|todo] [summary content]",
      "DELETE S[summary_id]",
      "If protocol cannot be followed, any non-empty text is acceptable. Then continue with the task.",
    ].join("\n");
  }
  return [
    "建议使用 summary_patch_v1（与计划 patch 协议独立）。",
    "语法：",
    "ADD S[小结ID] plan=[主计划ID] status=[done|in_progress|risk|todo] [小结内容]",
    "UPDATE S[小结ID] status=[done|in_progress|risk|todo] [小结内容]",
    "DELETE S[小结ID]",
    "若无法按协议输出，返回非空文本也可。小结后请继续任务，输出已完成项及问题说明。",
  ].join("\n");
}

export function buildAcceptancePatchProtocolText({
  locale = LOCALE.ZH_CN,
  mode = "final",
} = {}) {
  const normalizedLocale = resolveLocale(locale);
  const normalizedMode = String(mode || "final").trim().toLowerCase() === "phase" ? "phase" : "final";
  const title =
    normalizedMode === "phase"
      ? normalizedLocale === LOCALE.EN_US
        ? "[Acceptance ID+PATCH Protocol: acceptance_patch_v1 / phase]"
        : "【验收 ID+PATCH 协议：acceptance_patch_v1 / 阶段验收】"
      : normalizedLocale === LOCALE.EN_US
        ? "[Acceptance ID+PATCH Protocol: acceptance_patch_v1 / final]"
        : "【验收 ID+PATCH 协议：acceptance_patch_v1 / 总体验收】";
  if (normalizedLocale === LOCALE.EN_US) {
    return [
      title,
      "Output one command per line. Prefer this protocol; if impossible, still return non-empty plain text.",
      "Commands:",
      "ADD A[acceptance_id] plan=plan_id status=[pass|warn|fail] risk=[low|medium|high] evidence=[short_evidence] [acceptance conclusion]",
      "UPDATE A[acceptance_id] plan=plan_id status=[pass|warn|fail] risk=[low|medium|high] evidence=[short_evidence] [acceptance conclusion]",
      "DELETE A[acceptance_id]",
      "ID rules:",
      "A[acceptance_id] is stable inside this acceptance report, starts from A1, and increases by 1.",
      "plan=plan_id references the system-provided plan checklist ID; sub-plan IDs such as 2.1 are allowed when present.",
      "Status semantics:",
      "pass = accepted with evidence; warn = partially accepted or has low/medium risk; fail = unmet, unsupported, or blocked.",
      "Evidence must be short and grounded in context/tool results/final output. Do not invent evidence.",
    ].join("\n");
  }
  return [
    title,
    "每行输出一条命令。优先使用该协议；若无法严格遵循，仍需返回非空纯文本。",
    "命令：",
    "ADD A[验收ID] plan=计划ID status=[pass|warn|fail] risk=[low|medium|high] evidence=[简短证据] [验收结论]",
    "UPDATE A[验收ID] plan=计划ID status=[pass|warn|fail] risk=[low|medium|high] evidence=[简短证据] [验收结论]",
    "DELETE A[验收ID]",
    "ID 规则：",
    "A[验收ID] 在本次验收报告内稳定，从 A1 开始按 1 递增。",
    "plan=计划ID 必须引用 system 提供的计划清单 ID；若存在子计划，可使用 2.1 这类子计划 ID。",
    "状态语义：",
    "pass = 有证据支撑且通过；warn = 部分通过或存在低/中风险；fail = 未满足、无证据或阻塞。",
    "evidence 必须简短，并来自上下文、工具结果或最终输出；不要编造证据。",
  ].join("\n");
}
