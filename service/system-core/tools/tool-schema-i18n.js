/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TOOL_SCHEMA_BY_TOOL as zhToolSchemaByTool } from "../i18n/locales/zh-CN.js";
import { TOOL_SCHEMA_BY_TOOL as enToolSchemaByTool } from "../i18n/locales/en-US.js";
import { resolveToolLocale } from "./tool-i18n.js";

const TOOL_SCHEMA_I18N = Object.freeze({
  "zh-CN": Object.freeze(zhToolSchemaByTool || {}),
  "en-US": Object.freeze(enToolSchemaByTool || {}),
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

export function getLocalizedToolSchemaCatalog(runtime = {}) {
  const schemaMap = resolveLocaleToolSchemaMap(runtime) || {};
  const output = {};
  for (const [toolName, schema] of Object.entries(schemaMap)) {
    const params = schema?.params && typeof schema.params === "object" ? schema.params : {};
    output[toolName] = {
      descriptions: String(schema?.description?.text || "").trim(),
      params: Object.fromEntries(
        Object.entries(params).map(([paramName, paramSpec]) => [
          paramName,
          String(paramSpec?.text || "").trim(),
        ]),
      ),
    };
  }
  return output;
}
