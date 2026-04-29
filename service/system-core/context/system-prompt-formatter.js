/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function toSystemSection(title, content) {
  return `# ${title}\n${content}`;
}

function hasLongMemoryValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

const WORKSPACE_DIRECTORY_DESCRIPTIONS = {
  runtime: "运行时数据根目录",
  "runtime/attach": "附件根目录（按 sessionId 与来源分目录存储）",
  "runtime/attach/scoped": "附件分组目录：scoped/<sessionId>/<source>/attachments.json",
  "runtime/connectors": "连接器运行与历史信息（如 connector-history.json）",
  "runtime/session": "会话与执行记录",
  "runtime/workspace": "脚本执行与中间产物工作区",
  "runtime/memory": "短期/长期记忆数据",
  skills: "技能目录",
};

function buildWorkspaceDirectorySection(workspaceDirectories = []) {
  const directoryItems = (workspaceDirectories || []).map((dirPath) => ({
    path: dirPath,
    description: WORKSPACE_DIRECTORY_DESCRIPTIONS[dirPath] || "用户工作区目录",
  }));
  return JSON.stringify(directoryItems, null, 2);
}

export function composeSystemInfoSections({
  systemPrompt,
  staticInfo,
  dynamicInfo,
  longMemory = null,
  workspaceDirectories,
  modelSection,
  skills,
  services,
  mcpServers,
  attachmentMetas,
  connectorStatusSection,
}) {
  return [
    systemPrompt,
    toSystemSection("系统运行环境", JSON.stringify(staticInfo, null, 2)),
    toSystemSection("当前会话动态信息", JSON.stringify(dynamicInfo, null, 2)),
    toSystemSection(
      "工作区目录信息",
      buildWorkspaceDirectorySection(workspaceDirectories),
    ),
    ...(hasLongMemoryValue(longMemory)
      ? [
          toSystemSection(
            "相关长期记忆",
            typeof longMemory === "string"
              ? longMemory
              : JSON.stringify(longMemory, null, 2),
          ),
        ]
      : []),
    toSystemSection("可用模型与当前模型", JSON.stringify(modelSection, null, 2)),
    toSystemSection("技能清单（一级）", JSON.stringify(skills, null, 2)),
    toSystemSection(
      "可用外部服务端点（serviceName + endpointName + description）",
      JSON.stringify(services, null, 2),
    ),
    toSystemSection(
      "可用 MCP Servers（name + type + description）",
      JSON.stringify(mcpServers, null, 2),
    ),
    toSystemSection(
      "当前连接器信息",
      JSON.stringify(connectorStatusSection || {}, null, 2),
    ),
    toSystemSection(
      "当前附件元信息",
      attachmentMetas?.length
        ? JSON.stringify(
            attachmentMetas.map((attachmentItem) =>
              typeof attachmentItem === "string"
                ? attachmentItem
                : attachmentItem?.path || attachmentItem,
            ),
            null,
            2,
          )
        : "(无)",
    ),
  ];
}

