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
  mergedText = "",
} = {}) {
  const builder = promptI18n?.weeklySummaryPrompt;
  if (typeof builder === "function") {
    const prompt = String(
      builder({
        domainName,
        mergedText,
      }) || "",
    ).trim();
    if (prompt) return prompt;
  }
  return [
    "【系统指令】",
    `对以下【${domainName}】领域过去7天的记录进行体系化总结。`,
    "",
    "【任务要求】",
    "1. 划分大类：根据内容相关性划分子类别（如：性能优化、架构设计）。",
    "2. 提炼总结：合并重复项，提取每个大类最核心的经验与教训（各1-3条）。",
    "3. 仅输出严格的JSON，不要任何Markdown标记或解释。格式如下：",
    '{"domain_name":"当前领域名","categories":[{"category_name":"大类名","experiences":["经验1"],"lessons":["教训1"]}]}',
    "",
    "【输入内容】",
    mergedText,
  ].join("\n");
}

