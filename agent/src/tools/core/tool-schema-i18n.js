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
  "zh-CN": Object.freeze(zhToolSchemaByTool),
  "en-US": Object.freeze(enToolSchemaByTool),
});

const TOOL_MANUAL_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhToolManualByTool),
  "en-US": Object.freeze(enToolManualByTool),
});

function resolveLocaleEntry(catalog, runtime, toolName, kind) {
  const locale = resolveToolLocale(runtime);
  const entry = catalog[locale]?.[toolName];
  if (!entry) {
    throw new Error(`tool ${kind} i18n not configured: ${locale}.${toolName}`);
  }
  return entry;
}

export function tToolManual(runtime, toolName) {
  return resolveLocaleEntry(TOOL_MANUAL_I18N, runtime, toolName, "manual");
}

export function tToolDescription(runtime, toolName) {
  const descriptionText = resolveLocaleEntry(TOOL_SCHEMA_I18N, runtime, toolName, "schema")
    .description?.text;
  if (!descriptionText) {
    throw new Error(`tool description i18n not configured: ${toolName}`);
  }
  return descriptionText;
}

export function tToolParamDescription(runtime, toolName, paramName) {
  const paramText = resolveLocaleEntry(TOOL_SCHEMA_I18N, runtime, toolName, "schema").params?.[
    paramName
  ]?.text;
  if (!paramText) {
    throw new Error(`tool param schema i18n not configured: ${toolName}.${paramName}`);
  }
  return paramText;
}
