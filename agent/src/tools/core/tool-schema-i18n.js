/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TOOL_SCHEMA_BY_TOOL as zhToolSchemaByTool } from "noobot-i18n/agent/locales/zh-CN";
import { TOOL_SCHEMA_BY_TOOL as enToolSchemaByTool } from "noobot-i18n/agent/locales/en-US";
import { TOOL_MANUAL_BY_TOOL as zhToolManualByTool } from "noobot-i18n/agent/locales/zh-CN/tool-manual";
import { TOOL_MANUAL_BY_TOOL as enToolManualByTool } from "noobot-i18n/agent/locales/en-US/tool-manual";
import { resolveToolLocale } from "./tool-i18n.js";

const TOOL_SCHEMA_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhToolSchemaByTool || {}),
  "en-US": Object.freeze(enToolSchemaByTool || {}),
});

const TOOL_MANUAL_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhToolManualByTool || {}),
  "en-US": Object.freeze(enToolManualByTool || {}),
});

function resolveToolSchema(toolName = "") {
  const localeSchemas =
    TOOL_SCHEMA_I18N["zh-CN"] && typeof TOOL_SCHEMA_I18N["zh-CN"] === "object"
      ? TOOL_SCHEMA_I18N["zh-CN"]
      : {};
  const schema = localeSchemas[String(toolName || "").trim()];
  if (!schema) {
    throw new Error(`tool schema i18n not configured: ${String(toolName || "").trim()}`);
  }
  return schema;
}

function resolveLocaleToolSchemaMap(runtime = {}) {
  const locale = resolveToolLocale(runtime);
  return locale === "en-US" ? TOOL_SCHEMA_I18N["en-US"] : TOOL_SCHEMA_I18N["zh-CN"];
}

function resolveLocaleToolManualMap(runtime = {}) {
  const locale = resolveToolLocale(runtime);
  return locale === "en-US" ? TOOL_MANUAL_I18N["en-US"] : TOOL_MANUAL_I18N["zh-CN"];
}

export function tToolManual(runtime = {}, toolName = "") {
  const normalizedToolName = String(toolName || "").trim();
  const manual =
    resolveLocaleToolManualMap(runtime)?.[normalizedToolName] ||
    TOOL_MANUAL_I18N["zh-CN"]?.[normalizedToolName];
  return manual || null;
}

export function tToolDescription(runtime = {}, toolName = "") {
  const schema =
    resolveLocaleToolSchemaMap(runtime)?.[String(toolName || "").trim()] ||
    resolveToolSchema(toolName);
  return String(schema?.description?.text || "").trim();
}

export function tToolParamDescription(runtime = {}, toolName = "", paramName = "") {
  const schema =
    resolveLocaleToolSchemaMap(runtime)?.[String(toolName || "").trim()] ||
    resolveToolSchema(toolName);
  const text = schema?.params?.[String(paramName || "").trim()]?.text;
  if (!text) {
    throw new Error(
      `tool param schema i18n not configured: ${String(toolName || "").trim()}.${String(paramName || "").trim()}`,
    );
  }
  return String(text).trim();
}
