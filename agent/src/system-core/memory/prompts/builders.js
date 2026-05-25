/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getExperiencePatchPromptMeta } from "../experience/schema-config.js";

export function buildDailyExperiencePrompt({
  promptI18n = {},
  knownDomainText = "",
  shortMemoryItems = [],
} = {}) {
  const patchMeta = getExperiencePatchPromptMeta("daily");
  const builder = promptI18n?.dailyExperiencePrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        knownDomainText,
        shortMemoryItems,
        patchProtocol: patchMeta.protocol,
        patchExample: patchMeta.example,
      }) || "",
    ).trim();
    if (prompt) return prompt;
  }
  return [
    "【系统指令】",
    "分析以下短期记忆，将其归入已知领域或创建新领域。",
    `已知领域列表：${knownDomainText || "无"}`,
    "",
    "【任务要求】",
    "1. 提取每个涉及领域的经验和教训（各1-3条，宁缺毋滥，无则留空）。",
    "2. 仅输出 ID+PATCH 协议，不要 markdown 或解释。",
    `3. 协议：${patchMeta.protocol}`,
    "4. 示例：",
    patchMeta.example,
    "",
    "【输入内容】",
    JSON.stringify(shortMemoryItems, null, 2),
  ].join("\n");
}

export function buildWeeklySummaryPrompt({
  promptI18n = {},
  domainName = "",
  knownCategoryText = "",
  mergedText = "",
} = {}) {
  const patchMeta = getExperiencePatchPromptMeta("weekly");
  const builder = promptI18n?.weeklySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownCategoryText,
        mergedText,
        patchProtocol: patchMeta.protocol,
        patchExample: patchMeta.example,
      }) || "",
    ).trim();
    if (prompt) return prompt;
  }
  return [
    "【系统指令】",
    `对以下【${domainName}】领域过去7天的记录进行体系化总结。`,
    `已知大类列表：${knownCategoryText || "无"}`,
    "",
    "【任务要求】",
    "1. 优先归入已知大类，若完全不匹配可新增大类。",
    "2. 合并重复项，提取每个大类最核心的经验与教训（各1-3条）。",
    "3. 仅输出 ID+PATCH 协议，不要 markdown 或解释。",
    `4. 协议：${patchMeta.protocol}`,
    "5. 示例：",
    patchMeta.example,
    "",
    "【输入内容】",
    mergedText,
  ].join("\n");
}

export function buildMonthlySummaryPrompt({
  promptI18n = {},
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  const patchMeta = getExperiencePatchPromptMeta("monthly");
  const builder = promptI18n?.monthlySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownTreeText,
        mergedText,
        patchProtocol: patchMeta.protocol,
        patchExample: patchMeta.example,
      }) || "",
    ).trim();
    if (prompt) return prompt;
  }
  return [
    "【系统指令】",
    `分析以下【${domainName}】领域过去一个月的总结，聚焦模式识别。`,
    `已知大类与小类结构：${knownTreeText || "无"}`,
    "",
    "【任务要求】",
    "1. 将规律归入已知大类/小类；如有新发现可新增小类。",
    "2. 每个小类提炼 patterns 与 methodologies。",
    "3. 仅输出 ID+PATCH 协议，不要 markdown 或解释。",
    `4. 协议：${patchMeta.protocol}`,
    "5. 示例：",
    patchMeta.example,
    "",
    "【输入内容】",
    mergedText,
  ].join("\n");
}

export function buildYearlySummaryPrompt({
  promptI18n = {},
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  const patchMeta = getExperiencePatchPromptMeta("yearly");
  const builder = promptI18n?.yearlySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownTreeText,
        mergedText,
        patchProtocol: patchMeta.protocol,
        patchExample: patchMeta.example,
      }) || "",
    ).trim();
    if (prompt) return prompt;
  }
  return [
    "【系统指令】",
    `站在更高视角审视【${domainName}】领域过去一年的复盘。`,
    `已知分类树：${knownTreeText || "无"}`,
    "",
    "【任务要求】",
    "1. 忽略短期波动，提取底层原则或年度战略反思。",
    "2. 必须落到具体大类和小类。",
    "3. 仅输出 ID+PATCH 协议，不要 markdown 或解释。",
    `4. 协议：${patchMeta.protocol}`,
    "5. 示例：",
    patchMeta.example,
    "",
    "【输入内容】",
    mergedText,
  ].join("\n");
}
