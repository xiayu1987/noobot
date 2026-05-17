/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export function buildDailyExperiencePrompt({
  promptI18n = {},
  knownDomainText = "",
  shortMemoryItems = [],
} = {}) {
  const builder = promptI18n?.dailyExperiencePrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        knownDomainText,
        shortMemoryItems,
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
    "2. 仅输出严格的JSON，不要任何Markdown标记或解释。格式如下：",
    '{"results":[{"domain_name":"领域名","is_new_domain":true,"experiences":["经验1"],"lessons":["教训1"]}]}',
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
  const builder = promptI18n?.weeklySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownCategoryText,
        mergedText,
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
    "3. 仅输出严格的JSON，不要任何Markdown标记或解释。格式如下：",
    '{"domain_name":"当前领域名","categories":[{"category_name":"大类名","experiences":["经验1"],"lessons":["教训1"]}]}',
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
  const builder = promptI18n?.monthlySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownTreeText,
        mergedText,
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
    "3. 仅输出严格JSON：",
    '{"domain_name":"当前领域名","categories":[{"category_name":"大类名","subcategories":[{"subcategory_name":"小类名","patterns":["规律"],"methodologies":["方法论"]}]}]}',
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
  const builder = promptI18n?.yearlySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        knownTreeText,
        mergedText,
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
    "3. 仅输出严格JSON：",
    '{"domain_name":"当前领域名","categories":[{"category_name":"大类名","subcategories":[{"subcategory_name":"小类名","yearly_principles":["原则"],"strategic_reflections":["反思"]}]}]}',
    "",
    "【输入内容】",
    mergedText,
  ].join("\n");
}
