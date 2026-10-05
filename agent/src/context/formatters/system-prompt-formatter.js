/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeLocale } from "noobot-i18n/shared";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptFormatterI18n } from "noobot-i18n/agent/locales/zh-CN/system-prompt";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptFormatterI18n } from "noobot-i18n/agent/locales/en-US/system-prompt";
import { projectAttachmentMetaForModel } from "../../artifacts/index.js";

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
  const normalizedPath = String(dirPath || "")
    .trim()
    .replaceAll("\\", "/");
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

function buildPathGuidanceSection(staticInfo = {}, contextPromptI18n = {}) {
  const pathGuidanceI18n =
    contextPromptI18n?.pathGuidance && typeof contextPromptI18n.pathGuidance === "object"
      ? contextPromptI18n.pathGuidance
      : {};
  const identity =
    staticInfo?.identity && typeof staticInfo.identity === "object" ? staticInfo.identity : {};
  const sandboxView = String(staticInfo?.directories?.view || "").trim() === "sandbox";
  const lines = [
    pathGuidanceI18n.preferRelative,
    sandboxView ? pathGuidanceI18n.sandboxWorkspaceView : pathGuidanceI18n.hostWorkspaceView,
    pathGuidanceI18n.taskLocalView,
    sandboxView
      ? pathGuidanceI18n.sandboxHostAccess
      : identity?.isSuperUser === true
        ? pathGuidanceI18n.superUserHost
        : pathGuidanceI18n.regularHost,
    pathGuidanceI18n.patchRoot,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return lines.join("\n");
}

function toJsonSection(title, value, { allowEmpty = false, emptyValueText = "(none)" } = {}) {
  if (!allowEmpty && !hasValue(value)) return "";
  return toSystemSection(
    title,
    hasValue(value) ? JSON.stringify(value, null, 2) : String(emptyValueText || "(none)"),
  );
}

function hasConnectorData(connectorStatusSection = {}) {
  const connectors =
    connectorStatusSection && typeof connectorStatusSection === "object"
      ? connectorStatusSection.connectors || []
      : [];
  return Array.isArray(connectors) && connectors.length > 0;
}

function normalizeDynamicInfoForSystem(dynamicInfo = {}) {
  if (!dynamicInfo || typeof dynamicInfo !== "object" || Array.isArray(dynamicInfo)) {
    return {};
  }
  const config =
    dynamicInfo.config &&
    typeof dynamicInfo.config === "object" &&
    !Array.isArray(dynamicInfo.config)
      ? dynamicInfo.config
      : {};
  return {
    now: String(dynamicInfo.now || "").trim(),
    caller: String(dynamicInfo.caller || "user").trim() || "user",
    config: {
      allowUserInteraction: config.allowUserInteraction !== false,
    },
  };
}

function hasMcpServerData(mcpServers = []) {
  return Array.isArray(mcpServers) && mcpServers.length > 0;
}

function hasAttachmentData(normalizedAttachmentMetas = []) {
  return Array.isArray(normalizedAttachmentMetas) && normalizedAttachmentMetas.length > 0;
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function sectionTitle(sections, key) {
  return String(sections?.[key] || "").trim();
}

function textSection(title, content) {
  return hasValue(content) ? toSystemSection(title, content) : "";
}

function resolveContextPromptSettings(locale) {
  const contextPromptI18n = asObject(resolveSystemPromptFormatterI18n(locale)?.contextPrompt);
  return {
    contextPromptI18n,
    sections: contextPromptI18n?.sections || {},
    workspaceDirectoryDescriptions: asObject(contextPromptI18n?.workspaceDirectoryDescriptions),
    defaultWorkspaceDescription: String(
      contextPromptI18n?.defaultWorkspaceDescription || "",
    ).trim(),
    emptyValueText: String(contextPromptI18n?.emptyValueText || "(none)").trim(),
  };
}

function formatLongMemory(longMemory) {
  return typeof longMemory === "string" ? longMemory : JSON.stringify(longMemory, null, 2);
}

export function composeSystemInfoSections({
  locale = "zh-CN",
  systemPrompt = "",
  staticInfo = {},
  dynamicInfo = {},
  scenarioSection = {},
  longMemory = null,
  workspaceDirectories = [],
  modelSection = {},
  skills = [],
  services = [],
  mcpServers = [],
  attachments = [],
  connectorStatusSection = {},
}) {
  const {
    contextPromptI18n,
    sections,
    workspaceDirectoryDescriptions,
    defaultWorkspaceDescription,
    emptyValueText,
  } = resolveContextPromptSettings(locale);
  const jsonOptions = { emptyValueText };
  const jsonSection = (key, value) =>
    toJsonSection(sectionTitle(sections, key), value, jsonOptions);
  const workspaceSection = buildWorkspaceDirectorySection({
    workspaceDirectories,
    workspaceDirectoryDescriptions,
    defaultWorkspaceDescription,
  });
  const normalizedAttachmentMetas = (Array.isArray(attachments) ? attachments : []).map(
    projectAttachmentMetaForModel,
  );
  const executionEvidence = hasValue(contextPromptI18n?.executionEvidence)
    ? String(contextPromptI18n.executionEvidence).trim()
    : "";
  return [
    String(systemPrompt || "").trim(),
    jsonSection("staticInfo", staticInfo),
    textSection(
      sectionTitle(sections, "pathGuidance"),
      buildPathGuidanceSection(staticInfo, contextPromptI18n),
    ),
    executionEvidence
      ? toSystemSection(sectionTitle(sections, "executionEvidence"), executionEvidence)
      : "",
    jsonSection("dynamicInfo", normalizeDynamicInfoForSystem(dynamicInfo)),
    jsonSection("scenario", scenarioSection),
    textSection(sectionTitle(sections, "workspaceDirectories"), workspaceSection),
    hasValue(longMemory)
      ? toSystemSection(sectionTitle(sections, "longMemory"), formatLongMemory(longMemory))
      : "",
    jsonSection("models", modelSection),
    jsonSection("skills", skills),
    jsonSection("services", services),
    hasMcpServerData(mcpServers) ? jsonSection("mcpServers", mcpServers) : "",
    hasConnectorData(connectorStatusSection)
      ? jsonSection("connectors", connectorStatusSection)
      : "",
    hasAttachmentData(normalizedAttachmentMetas)
      ? jsonSection("attachments", normalizedAttachmentMetas)
      : "",
  ].filter(Boolean);
}
