/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeLocale } from "../i18n/index.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptFormatterI18n } from "../i18n/locales/zh-CN/system-prompt.js";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptFormatterI18n } from "../i18n/locales/en-US/system-prompt.js";

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

const SYSTEM_PROMPT_FORMATTER_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhSystemPromptFormatterI18n || {}),
  "en-US": Object.freeze(enSystemPromptFormatterI18n || {}),
});

function resolveSystemPromptFormatterI18n(locale = "zh-CN") {
  const normalizedLocale = normalizeLocale(locale, "zh-CN");
  return normalizedLocale === "en-US"
    ? SYSTEM_PROMPT_FORMATTER_I18N["en-US"]
    : SYSTEM_PROMPT_FORMATTER_I18N["zh-CN"];
}

function resolveWorkspaceDescription(
  dirPath = "",
  workspaceDirectoryDescriptions = {},
  defaultWorkspaceDescription = "",
) {
  const normalizedPath = String(dirPath || "").trim().replaceAll("\\", "/");
  if (!normalizedPath) return String(defaultWorkspaceDescription || "").trim();
  if (workspaceDirectoryDescriptions[normalizedPath]) {
    return workspaceDirectoryDescriptions[normalizedPath];
  }
  const suffixHit = Object.entries(workspaceDirectoryDescriptions).find(
    ([key]) =>
      normalizedPath === key ||
      normalizedPath.endsWith(`/${key}`) ||
      normalizedPath.includes(`/${key}/`),
  );
  return suffixHit?.[1] || String(defaultWorkspaceDescription || "").trim();
}

function buildWorkspaceDirectorySection({
  workspaceDirectories = [],
  workspaceDirectoryDescriptions = {},
  defaultWorkspaceDescription = "",
} = {}) {
  const directoryItems = (workspaceDirectories || []).map((dirPath) => ({
    path: dirPath,
    description: resolveWorkspaceDescription(
      dirPath,
      workspaceDirectoryDescriptions,
      defaultWorkspaceDescription,
    ),
  }));
  return JSON.stringify(directoryItems, null, 2);
}

function toJsonSection(title, value, { allowEmpty = false, emptyValueText = "(none)" } = {}) {
  if (!allowEmpty && !hasValue(value)) return "";
  return toSystemSection(
    title,
    hasValue(value) ? JSON.stringify(value, null, 2) : String(emptyValueText || "(none)"),
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
  locale = "zh-CN",
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
  const i18n = resolveSystemPromptFormatterI18n(locale);
  const contextPromptI18n =
    i18n?.contextPrompt && typeof i18n.contextPrompt === "object"
      ? i18n.contextPrompt
      : {};
  const sections = contextPromptI18n?.sections || {};
  const workspaceDirectoryDescriptions =
    contextPromptI18n?.workspaceDirectoryDescriptions &&
    typeof contextPromptI18n.workspaceDirectoryDescriptions === "object"
      ? contextPromptI18n.workspaceDirectoryDescriptions
      : {};
  const defaultWorkspaceDescription = String(
    contextPromptI18n?.defaultWorkspaceDescription || "",
  ).trim();
  const emptyValueText = String(contextPromptI18n?.emptyValueText || "(none)").trim();
  const normalizedSystemPrompt = String(systemPrompt || "").trim();
  const normalizedWorkspaceSection = buildWorkspaceDirectorySection({
    workspaceDirectories,
    workspaceDirectoryDescriptions,
    defaultWorkspaceDescription,
  });
  const normalizedAttachmentMetas = normalizeAttachmentMetas(attachmentMetas);
  return [
    normalizedSystemPrompt,
    toJsonSection(String(sections?.staticInfo || "").trim(), staticInfo, { emptyValueText }),
    toJsonSection(String(sections?.dynamicInfo || "").trim(), dynamicInfo, { emptyValueText }),
    hasValue(normalizedWorkspaceSection)
      ? toSystemSection(
          String(sections?.workspaceDirectories || "").trim(),
          normalizedWorkspaceSection,
        )
      : "",
    hasValue(longMemory)
      ? toSystemSection(
          String(sections?.longMemory || "").trim(),
          typeof longMemory === "string"
            ? longMemory
            : JSON.stringify(longMemory, null, 2),
        )
      : "",
    toJsonSection(String(sections?.models || "").trim(), modelSection, { emptyValueText }),
    toJsonSection(String(sections?.skills || "").trim(), skills, { emptyValueText }),
    toJsonSection(
      String(sections?.services || "").trim(),
      services,
      { emptyValueText },
    ),
    toJsonSection(String(sections?.mcpServers || "").trim(), mcpServers, { emptyValueText }),
    toJsonSection(String(sections?.connectors || "").trim(), connectorStatusSection, {
      emptyValueText,
    }),
    toJsonSection(String(sections?.attachments || "").trim(), normalizedAttachmentMetas, {
      emptyValueText,
    }),
  ].filter(Boolean);
}
