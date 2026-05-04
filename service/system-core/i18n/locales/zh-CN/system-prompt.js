/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SYSTEM_PROMPT_FORMATTER_I18N = {
  contextPrompt: {
    emptyValueText: "(无)",
    defaultWorkspaceDescription: "用户工作区目录",
    workspaceDirectoryDescriptions: {
      runtime: "运行时数据根目录",
      "runtime/attach": "附件根目录（按 sessionId 与来源分目录存储）",
      "runtime/attach/scoped":
        "附件分组目录：scoped/<sessionId>/<source>/attachments.json",
      "runtime/connectors": "连接器运行与历史信息（如 connector-history.json）",
      "runtime/session": "会话与执行记录",
      "runtime/workspace": "脚本执行与中间产物工作区",
      "runtime/memory": "短期/长期记忆数据",
      skills: "技能目录",
    },
    sections: {
      staticInfo: "系统运行环境",
      dynamicInfo: "当前会话动态信息",
      workspaceDirectories: "工作区目录信息",
      longMemory: "相关长期记忆",
      models: "可用模型与当前模型",
      skills: "技能清单（一级）",
      services: "可用外部服务端点（serviceName + endpointName + description）",
      mcpServers: "可用 MCP Servers（name + type + description）",
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
        ? `请严格遵守以下长期记忆建模规则（来自 long-memory-model.md）：\n${longMemoryModel}`
        : "若未提供建模规则，请优先提炼稳定偏好、长期约束。";
      return [
        "你是长期记忆提炼器。",
        modelRuleText,
        "请基于“已有长期记忆”与“新短期记忆块”，产出最新的长期偏好。",
        "你可以对已有长期偏好进行总结处理",
        `已有长期偏好:\n${existingLongMemory}`,
        `新短期记忆块:\n${promptPayload}`,
      ].join("\n\n");
    },
  },
};
