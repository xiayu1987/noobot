/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

const DAILY_EXPERIENCE_PATCH_EXAMPLE =
  'ADD D[1] domain="领域" new=true experiences="经验1 || 经验2" lessons="教训1 || 教训2"';

const WEEKLY_SUMMARY_PATCH_EXAMPLE =
  'ADD W[1] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
const MONTHLY_SUMMARY_PATCH_EXAMPLE =
  'ADD M[1] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"';
const YEARLY_SUMMARY_PATCH_EXAMPLE =
  'ADD Y[1] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"';


const EXPERIENCE_PATCH_PROTOCOLS = Object.freeze({
  daily: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    example: DAILY_EXPERIENCE_PATCH_EXAMPLE,
  }),
  weekly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE W[整数ID] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"',
    example: WEEKLY_SUMMARY_PATCH_EXAMPLE,
  }),
  monthly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE M[整数ID] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"',
    example: MONTHLY_SUMMARY_PATCH_EXAMPLE,
  }),
  yearly: Object.freeze({
    protocol:
      'ADD/UPDATE/DELETE Y[整数ID] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"',
    example: YEARLY_SUMMARY_PATCH_EXAMPLE,
  }),
});

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
      "runtime/ops_workdir": "脚本执行与中间工作区",
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
    experiencePatchProtocols: EXPERIENCE_PATCH_PROTOCOLS,
    prompt: (params = {}) => {
      const longMemoryModel = String(params.longMemoryModel || "").trim();
      const longMemoryMetadata = String(params.longMemoryMetadata || "").trim();
      const existingLongMemory =
        typeof params.existingLongMemory === "string"
          ? params.existingLongMemory
          : JSON.stringify(params.existingLongMemory ?? "", null, 2);
      const promptPayload = JSON.stringify(params.promptPayload ?? []);
      const fieldModelText = longMemoryModel
        ? `【长期记忆字段模型（来自 long-memory-model.md）】\n${longMemoryModel}`
        : "【长期记忆字段模型】未提供字段模型时，优先保留稳定偏好与长期约束。";
      return [
        "你是长期记忆整理助手。",
        fieldModelText,
        "【长期记忆 ID+PATCH 协议】",
        "每行输出一条命令；只输出命令，不要 markdown、JSON 或解释。",
        "ADD L[记忆ID] [稳定长期记忆]",
        "UPDATE L[记忆ID] [修改后的稳定长期记忆]",
        "DELETE L[记忆ID]",
        "ADD M[元数据ID] key=\"字段\" value=\"值\"",
        "UPDATE M[元数据ID] key=\"字段\" value=\"值\"",
        "DELETE M[元数据ID]",
        "硬性约束：L/M ID 必须使用正整数；更新或删除必须复用已有 ID；新增使用未占用 ID。",
        "记忆规则：只记录稳定、长期、可复用的信息；临时任务、一次性报错、短期安排、无证据推测不要写入；新信息修正旧信息用 UPDATE，旧信息过期或被否定用 DELETE，不要重复 ADD 近义记忆。",
        "请基于“已有长期记忆”“长期记忆元数据”和“新的短期记忆片段”产出 ID+PATCH 更新指令。",
        `已有长期偏好：\n${existingLongMemory}`,
        `已有长期记忆元数据：\n${longMemoryMetadata || "（空）"}`,
        `新的短期记忆片段：\n${promptPayload}`,
      ].join("\n\n");
    },
    dailyExperiencePrompt: (params = {}) => {
      const knownDomainText = String(params.knownDomainText || "").trim();
      const shortMemoryItems = JSON.stringify(params.shortMemoryItems ?? [], null, 2);
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE D[整数ID] domain="领域" new=true|false experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
      const patchExample = String(params.patchExample || "").trim()
        || DAILY_EXPERIENCE_PATCH_EXAMPLE;
      return [
        "系统指令：",
        "请分析以下短期记忆，归类到已知领域，或在必要时创建新领域。",
        `已知领域：${knownDomainText || "无"}`,
        "",
        "任务要求：",
        "1. 为每个涉及领域提炼 experiences 与 lessons（各 1-3 条，优先质量；无则留空）。",
        "2. 领域应保持高层抽象，避免过细碎（如：编程、项目管理、测试、产品）。",
        "3. domain_name 保持简洁，尽量复用已知领域。",
        "4. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `5. 协议：${patchProtocol}`,
        "6. 示例：",
        patchExample,
        "",
        "输入：",
        shortMemoryItems,
      ].join("\n");
    },
    weeklySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownCategoryText = String(params.knownCategoryText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE W[整数ID] category="大类" experiences="经验1 || 经验2" lessons="教训1 || 教训2"';
      const patchExample = String(params.patchExample || "").trim()
        || WEEKLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `请对领域 [${domainName}] 最近 7 天的记录进行结构化周总结。`,
        `已知大类列表：${knownCategoryText || "无"}`,
        "",
        "任务要求：",
        "1. 优先归入已知大类；若完全不匹配可新增大类。",
        "2. 分类归组：按语义相关性拆分，并尽量合并近义项，避免碎片化。",
        "3. 归纳提炼：去重合并后，提炼每类最关键的 experiences 与 lessons（各 1-3 条）。",
        "4. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `5. 协议：${patchProtocol}`,
        "6. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    monthlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE M[整数ID] category="大类" subcategory="小类" patterns="规律1 || 规律2" methodologies="方法1 || 方法2"';
      const patchExample = String(params.patchExample || "").trim()
        || MONTHLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `分析以下【${domainName}】领域过去一个月的总结，目标是模式识别。`,
        `已知大类与小类结构：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 将规律归入已知大类和小类；若有全新发现，可输出新的小类名称。",
        "2. 为每个小类提炼本月核心规律（Patterns）和改进方法论（Methodologies）。",
        "3. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `4. 协议：${patchProtocol}`,
        "5. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
    yearlySummaryPrompt: (params = {}) => {
      const domainName = String(params.domainName || "").trim();
      const knownTreeText = String(params.knownTreeText || "").trim();
      const mergedText = String(params.mergedText || "");
      const patchProtocol = String(params.patchProtocol || "").trim()
        || 'ADD/UPDATE/DELETE Y[整数ID] category="大类" subcategory="小类" principles="原则1 || 原则2" reflections="反思1 || 反思2"';
      const patchExample = String(params.patchExample || "").trim()
        || YEARLY_SUMMARY_PATCH_EXAMPLE;
      return [
        "系统指令：",
        `站在高维视角审视【${domainName}】领域过去一年的全部复盘。`,
        `已知分类树：${knownTreeText || "无"}`,
        "",
        "任务要求：",
        "1. 忽略短期波动，提炼跨时间的底层原则（Principles）与年度战略反思。",
        "2. 必须将输出落实到具体的大类和小类。",
        "3. 仅输出 ID+PATCH，不要输出 markdown 或解释。",
        `4. 协议：${patchProtocol}`,
        "5. 示例：",
        patchExample,
        "",
        "输入：",
        mergedText,
      ].join("\n");
    },
  },
};
