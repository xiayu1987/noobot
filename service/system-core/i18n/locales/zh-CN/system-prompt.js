/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DAILY_EXPERIENCE_JSON_SCHEMA_EXAMPLE =
  '{"results":[{"domain_name":"领域名称","is_new_domain":true,"experiences":["经验1"],"lessons":["教训1"]}]}';

const WEEKLY_SUMMARY_JSON_SCHEMA_EXAMPLE =
  '{"domain_name":"当前领域", "categories":[{"category_name":"分类", "experiences":["经验1"], "lessons":["教训1"]}]}';
const MONTHLY_SUMMARY_JSON_SCHEMA_EXAMPLE =
  '{"domain_name":"当前领域","categories":[{"category_name":"大类","subcategories":[{"subcategory_name":"小类","patterns":["规律"],"methodologies":["方法论"]}]}]}';
const YEARLY_SUMMARY_JSON_SCHEMA_EXAMPLE =
  '{"domain_name":"当前领域","categories":[{"category_name":"大类","subcategories":[{"subcategory_name":"小类","yearly_principles":["底层原则"],"strategic_reflections":["战略反思"]}]}]}';

export const SYSTEM_PROMPT_FORMATTER_I18N = {
  contextPrompt: {
    emptyValueText: "（无）",
    defaultWorkspaceDescription: "用户工作区目录",
    workspaceDirectoryDescriptions: {
      runtime: "运行时数据根目录",
      "runtime/attach": "附件根目录（按 sessionId/source 分组）",
      "runtime/attach/scoped": "附件作用域目录：scoped/<sessionId>/<source>/attachments.json",
      "runtime/connectors": "连接器运行与历史信息（如 connector-history.json）",
      "runtime/session": "会话与执行记录",
      "runtime/workspace": "脚本执行与中间工作区",
      "runtime/memory": "短期/长期记忆数据",
      skills: "技能目录",
    },
    sections: {
      staticInfo: "系统运行环境",
      dynamicInfo: "当前会话动态上下文",
      scenario: "当前场景配置（名称、描述、约束）",
      workspaceDirectories: "工作区目录",
      longMemory: "相关长期记忆",
      models: "可用模型与当前模型",
      skills: "技能列表（顶层）",
      services: "可用外部服务端点（serviceName + endpointName + description）",
      mcpServers: "可用 MCP 服务器（name + type + description）",
      connectors: "当前连接器信息",
      attachments: "当前附件元信息",
    },
  },
  memoryPrompt: {
    prompt: (params = {}) => {
      const longMemoryModel = String(params.longMemoryModel || "").trim();
      const existingLongMemory =
        typeof params.existingLongMemory === "string"
          ? params.existingLongMemory
          : JSON.stringify(params.existingLongMemory ?? "", null, 2);
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      const modelRuleText = longMemoryModel
        ? `请严格遵循以下长期记忆建模规则（来自 long-memory-model.json）：\n${longMemoryModel}`
        : "若未提供记忆模型规则，请优先保留稳定偏好与长期约束。";
      return [
        "你是长期记忆整理助手。",
        modelRuleText,
        "请基于“已有长期记忆”和“新的短期记忆片段”产出更新后的长期偏好。",
        "必要时可对已有长期偏好进行合并与总结。",
        `已有长期偏好：\n${existingLongMemory}`,
        `新的短期记忆片段：\n${promptPayload}`,
      ].join("\n\n");
    },
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      return [
        "系统指令：",
        "请分析以下短期记忆，归类到已知领域，或在必要时创建新领域。",
        `已知领域：${knownDomainText || "无"}`,
        "",
        "任务要求：",
        "1. 为每个涉及领域提炼 experiences 与 lessons（各 1-3 条，优先质量；无则留空）。",
        "2. 领域应保持高层抽象，避免过细碎（如：编程、项目管理、测试、产品）。",
        "3. domain_name 保持简洁，尽量复用已知领域。",
        "4. 仅输出严格 JSON，不要输出 markdown 或解释，格式如下：",
        DAILY_EXPERIENCE_JSON_SCHEMA_EXAMPLE,
        "",
        "输入：",
        shortMemoryItems,
      ].join("\n");
    },
    weeklySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownCategoryText = String(params.knownCategoryText || "").trim();
      const mergedText = String(params.mergedText || "");
      return [
        "系统指令：",
        `请对领域 [${domainName}] 最近 7 天的记录进行结构化周总结。`,
        `已知大类列表：${knownCategoryText || "无"}`,
        "",
        "任务要求：",
        "1. 优先归入已知大类；若完全不匹配可新增大类。",
        "2. 分类归组：按语义相关性拆分，并尽量合并近义项，避免碎片化。",
        "3. 归纳提炼：去重合并后，提炼每类最关键的 experiences 与 lessons（各 1-3 条）。",
        "4. 仅输出严格 JSON，不要输出 markdown 或解释，格式如下：",
        WEEKLY_SUMMARY_JSON_SCHEMA_EXAMPLE,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    monthlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      return [
        "系统指令：",
        `分析以下【${domainName}】领域过去一个月的总结，目标是模式识别。`,
        `已知大类与小类结构：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 将规律归入已知大类和小类；若有全新发现，可输出新的小类名称。",
        "2. 为每个小类提炼本月核心规律（Patterns）和改进方法论（Methodologies）。",
        "3. 仅输出严格 JSON，不要输出 markdown 或解释，格式如下：",
        MONTHLY_SUMMARY_JSON_SCHEMA_EXAMPLE,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    yearlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      return [
        "系统指令：",
        `站在高维视角审视【${domainName}】领域过去一年的全部复盘。`,
        `已知分类树：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 忽略短期波动，提炼跨时间的底层原则（Principles）与年度战略反思。",
        "2. 必须将输出落实到具体的大类和小类。",
        "3. 仅输出严格 JSON，不要输出 markdown 或解释，格式如下：",
        YEARLY_SUMMARY_JSON_SCHEMA_EXAMPLE,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
  },
};
