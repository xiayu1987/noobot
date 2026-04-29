/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
function toSystemSection(title, content) {
  return `# ${title}\n${content}`;
}

function hasValue(value) {
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

function resolveWorkspaceDescription(dirPath = "") {
  const normalizedPath = String(dirPath || "").trim().replaceAll("\\", "/");
  if (!normalizedPath) return "用户工作区目录";
  if (WORKSPACE_DIRECTORY_DESCRIPTIONS[normalizedPath]) {
    return WORKSPACE_DIRECTORY_DESCRIPTIONS[normalizedPath];
  }
  const suffixHit = Object.entries(WORKSPACE_DIRECTORY_DESCRIPTIONS).find(
    ([key]) =>
      normalizedPath === key ||
      normalizedPath.endsWith(`/${key}`) ||
      normalizedPath.includes(`/${key}/`),
  );
  return suffixHit?.[1] || "用户工作区目录";
}

function buildWorkspaceDirectorySection(workspaceDirectories = []) {
  const directoryItems = (workspaceDirectories || []).map((dirPath) => ({
    path: dirPath,
    description: resolveWorkspaceDescription(dirPath),
  }));
  return JSON.stringify(directoryItems, null, 2);
}

function toJsonSection(title, value, { allowEmpty = false } = {}) {
  if (!allowEmpty && !hasValue(value)) return "";
  return toSystemSection(
    title,
    hasValue(value) ? JSON.stringify(value, null, 2) : "(无)",
  );
}

function normalizeAttachmentMetas(attachmentMetas = []) {
  const source = Array.isArray(attachmentMetas) ? attachmentMetas : [];
  return source
    .map((attachmentItem) => {
      if (typeof attachmentItem === "string") {
        const path = String(attachmentItem || "").trim();
        return path ? { path } : null;
      }
      if (!attachmentItem || typeof attachmentItem !== "object") return null;
      const normalized = {
        attachmentId: String(attachmentItem?.attachmentId || "").trim(),
        name: String(attachmentItem?.name || "").trim(),
        mimeType: String(
          attachmentItem?.mimeType || attachmentItem?.type || "",
        ).trim(),
        size: Number(attachmentItem?.size || 0),
        path: String(attachmentItem?.path || "").trim(),
      };
      if (!hasValue(normalized.attachmentId)) delete normalized.attachmentId;
      if (!hasValue(normalized.name)) delete normalized.name;
      if (!hasValue(normalized.mimeType)) delete normalized.mimeType;
      if (!hasValue(normalized.size)) delete normalized.size;
      if (!hasValue(normalized.path)) delete normalized.path;
      return hasValue(normalized) ? normalized : null;
    })
    .filter(Boolean);
}

export function composeSystemInfoSections({
  systemPrompt = "",
  staticInfo = {},
  dynamicInfo = {},
  longMemory = null,
  workspaceDirectories = [],
  modelSection = {},
  skills = [],
  services = [],
  mcpServers = [],
  attachmentMetas = [],
  connectorStatusSection = {},
}) {
  const normalizedSystemPrompt = String(systemPrompt || "").trim();
  const normalizedWorkspaceSection = buildWorkspaceDirectorySection(
    workspaceDirectories,
  );
  const normalizedAttachmentMetas = normalizeAttachmentMetas(attachmentMetas);
  return [
    normalizedSystemPrompt,
    toJsonSection("系统运行环境", staticInfo),
    toJsonSection("当前会话动态信息", dynamicInfo),
    hasValue(normalizedWorkspaceSection)
      ? toSystemSection("工作区目录信息", normalizedWorkspaceSection)
      : "",
    hasValue(longMemory)
      ? toSystemSection(
          "相关长期记忆",
          typeof longMemory === "string"
            ? longMemory
            : JSON.stringify(longMemory, null, 2),
        )
      : "",
    toJsonSection("可用模型与当前模型", modelSection),
    toJsonSection("技能清单（一级）", skills),
    toJsonSection(
      "可用外部服务端点（serviceName + endpointName + description）",
      services,
    ),
    toJsonSection("可用 MCP Servers（name + type + description）", mcpServers),
    toJsonSection("当前连接器信息", connectorStatusSection),
    toJsonSection("当前附件元信息", normalizedAttachmentMetas),
  ].filter(Boolean);
}
