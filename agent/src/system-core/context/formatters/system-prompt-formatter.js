/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../../utils/shared-utils.js";
import { normalizeLocale } from "noobot-i18n/shared";
import { SYSTEM_PROMPT_FORMATTER_I18N as zhSystemPromptFormatterI18n } from "noobot-i18n/agent/locales/zh-CN/system-prompt";
import { SYSTEM_PROMPT_FORMATTER_I18N as enSystemPromptFormatterI18n } from "noobot-i18n/agent/locales/en-US/system-prompt";
import { normalizeAttachmentMetas } from "../../attach/index.js";

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


function hasConnectorData(connectorStatusSection = {}) {
  const currentConnectors =
    connectorStatusSection && typeof connectorStatusSection === "object"
      ? connectorStatusSection.current_connectors || {}
      : {};
  const hasSelectedConnector = Object.values(currentConnectors).some(
    (connectorItem) =>
      connectorItem &&
      typeof connectorItem === "object" &&
      hasValue(String(connectorItem.connector_name || "").trim()),
  );
  if (!hasSelectedConnector) return false;
  const connectors =
    connectorStatusSection && typeof connectorStatusSection === "object"
      ? connectorStatusSection.connectors || {}
      : {};
  const hasConnectorList =
    (Array.isArray(connectors?.databases) && connectors.databases.length > 0) ||
    (Array.isArray(connectors?.terminals) && connectors.terminals.length > 0) ||
    (Array.isArray(connectors?.emails) && connectors.emails.length > 0);
  if (hasConnectorList) return true;
  return hasSelectedConnector;
}

function stripEmptySelectedConnectors(dynamicInfo = {}) {
  if (!dynamicInfo || typeof dynamicInfo !== "object" || Array.isArray(dynamicInfo)) {
    return {};
  }
  const config =
    dynamicInfo?.config && typeof dynamicInfo.config === "object" && !Array.isArray(dynamicInfo.config)
      ? dynamicInfo.config
      : null;
  if (!config) return dynamicInfo;
  const selectedConnectors =
    config?.selectedConnectors &&
    typeof config.selectedConnectors === "object" &&
    !Array.isArray(config.selectedConnectors)
      ? config.selectedConnectors
      : null;
  if (!selectedConnectors) return dynamicInfo;
  const hasSelectedConnector = Object.values(selectedConnectors).some((connectorName) =>
    hasValue(String(connectorName || "").trim()),
  );
  if (hasSelectedConnector) return dynamicInfo;
  return {
    ...dynamicInfo,
    config: Object.fromEntries(
      Object.entries(config).filter(([configKey]) => configKey !== "selectedConnectors"),
    ),
  };
}

function hasMcpServerData(mcpServers = []) {
  return Array.isArray(mcpServers) && mcpServers.length > 0;
}

function hasAttachmentData(normalizedAttachmentMetas = []) {
  return (
    Array.isArray(normalizedAttachmentMetas) &&
    normalizedAttachmentMetas.length > 0
  );
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
  inputAttachmentMetas = null,
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
  const normalizedDynamicInfo = stripEmptySelectedConnectors(dynamicInfo);
  const normalizedWorkspaceSection = buildWorkspaceDirectorySection({
    workspaceDirectories,
    workspaceDirectoryDescriptions,
    defaultWorkspaceDescription,
  });
  const normalizedAttachmentMetas = normalizeAttachmentMetas(
    Array.isArray(inputAttachmentMetas) ? inputAttachmentMetas : attachmentMetas,
  );
  return [
    normalizedSystemPrompt,
    toJsonSection(String(sections?.staticInfo || "").trim(), staticInfo, { emptyValueText }),
    toJsonSection(String(sections?.dynamicInfo || "").trim(), normalizedDynamicInfo, { emptyValueText }),
    toJsonSection(String(sections?.scenario || "").trim(), scenarioSection, { emptyValueText }),
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
    hasMcpServerData(mcpServers)
      ? toJsonSection(String(sections?.mcpServers || "").trim(), mcpServers, { emptyValueText })
      : "",
    hasConnectorData(connectorStatusSection)
      ? toJsonSection(String(sections?.connectors || "").trim(), connectorStatusSection, {
          emptyValueText,
        })
      : "",
    hasAttachmentData(normalizedAttachmentMetas)
      ? toJsonSection(String(sections?.attachments || "").trim(), normalizedAttachmentMetas, {
          emptyValueText,
        })
      : "",
  ].filter(Boolean);
}
