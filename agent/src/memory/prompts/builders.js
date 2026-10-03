/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_EXPERIENCE_FIELDS } from "@noobot/memory-protocol/experience/fields";
import { renderExperiencePatchProtocol } from "@noobot/memory-protocol/experience/schema";

function resolvePatchMeta(promptI18n = {}, stage = "", fields = BUILTIN_EXPERIENCE_FIELDS) {
  return renderExperiencePatchProtocol(stage, {
    fields,
    labels: promptI18n?.experiencePatchLabels || {},
  });
}

function resolveLocalizedPrompt(builder, payload = {}) {
  if (typeof builder !== "function") return "";
  return String(builder(payload) || "").trim();
}

function buildPrompt({ promptI18n, stage, fields, builderName, payload, fallback }) {
  const patchMeta = resolvePatchMeta(promptI18n, stage, fields);
  const localized = resolveLocalizedPrompt(promptI18n?.[builderName], {
    ...payload,
    patchProtocol: patchMeta.protocol,
    patchExample: patchMeta.example,
    fieldGuide: patchMeta.fieldGuide,
  });
  if (localized) return localized;
  return fallback(patchMeta).join("\n");
}

function protocolLines(patchMeta, startIndex) {
  return [
    `${startIndex}. 仅输出 ID+PATCH 协议，不要 markdown 或解释。`,
    `${startIndex + 1}. 协议：${patchMeta.protocol}`,
    `${startIndex + 2}. 示例：`,
    patchMeta.example,
  ];
}

export function buildDailyExperiencePrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  knownDomainText = "",
  shortMemoryItems = [],
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "daily",
    fields,
    builderName: "dailyExperiencePrompt",
    payload: { knownDomainText, shortMemoryItems },
    fallback: (patchMeta) => [
      "【系统指令】",
      "分析以下短期记忆，将其归入已知领域或创建新领域。",
      `已知领域列表：${knownDomainText || "无"}`,
      "",
      "【输出字段】",
      patchMeta.fieldGuide,
      "",
      "【任务要求】",
      "1. 为每个涉及领域提取上述字段（各1-3条，宁缺毋滥，无则留空）。",
      ...protocolLines(patchMeta, 2),
      "",
      "【输入内容】",
      JSON.stringify(shortMemoryItems, null, 2),
    ],
  });
}

export function buildWeeklySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownCategoryText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "weekly",
    fields,
    builderName: "weeklySummaryPrompt",
    payload: { domainName, knownCategoryText, mergedText },
    fallback: (patchMeta) => [
      "【系统指令】",
      `对以下【${domainName}】领域过去7天的记录进行体系化总结。`,
      `已知大类列表：${knownCategoryText || "无"}`,
      "",
      "【输出字段】",
      patchMeta.fieldGuide,
      "",
      "【任务要求】",
      "1. 优先归入已知大类，若完全不匹配可新增大类。",
      "2. 合并重复项，为每个大类提取上述字段（各1-3条）。",
      ...protocolLines(patchMeta, 3),
      "",
      "【输入内容】",
      mergedText,
    ],
  });
}

export function buildMonthlySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "monthly",
    fields,
    builderName: "monthlySummaryPrompt",
    payload: { domainName, knownTreeText, mergedText },
    fallback: (patchMeta) => [
      "【系统指令】",
      `分析以下【${domainName}】领域过去一个月的总结，聚焦模式识别。`,
      `已知大类与小类结构：${knownTreeText || "无"}`,
      "",
      "【输出字段】",
      patchMeta.fieldGuide,
      "",
      "【任务要求】",
      "1. 将规律归入已知大类/小类；如有新发现可新增小类。",
      "2. 每个小类提炼上述字段。",
      ...protocolLines(patchMeta, 3),
      "",
      "【输入内容】",
      mergedText,
    ],
  });
}

export function buildYearlySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "yearly",
    fields,
    builderName: "yearlySummaryPrompt",
    payload: { domainName, knownTreeText, mergedText },
    fallback: (patchMeta) => [
      "【系统指令】",
      `站在更高视角审视【${domainName}】领域过去一年的复盘。`,
      `已知分类树：${knownTreeText || "无"}`,
      "",
      "【输出字段】",
      patchMeta.fieldGuide,
      "",
      "【任务要求】",
      "1. 忽略短期波动，按上述字段提炼跨时间的结论。",
      "2. 必须落到具体大类和小类。",
      ...protocolLines(patchMeta, 3),
      "",
      "【输入内容】",
      mergedText,
    ],
  });
}
