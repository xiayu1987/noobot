/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { CONNECTOR_TOOL_SCHEMA } from "./tool-schema/connectors.js";
import { FILE_TOOL_SCHEMA } from "./tool-schema/files.js";
import { TASK_ORCHESTRATION_TOOL_SCHEMA } from "./tool-schema/task-orchestration.js";
import { CONTENT_TOOL_SCHEMA } from "./tool-schema/content.js";
import { INVOCATION_TOOL_SCHEMA } from "./tool-schema/invocation.js";
import { ASSISTANCE_TOOL_SCHEMA } from "./tool-schema/assistance.js";

function buildToolSchemaFlat(schemaByTool = {}) {
  const flat = {};
  for (const spec of Object.values(schemaByTool || {})) {
    const description = spec?.description && typeof spec.description === "object"
      ? spec.description
      : {};
    const descriptionKey = String(description?.key || "").trim();
    const descriptionText = description?.text;
    if (descriptionKey) flat[descriptionKey] = descriptionText;

    const params = spec?.params && typeof spec.params === "object" ? spec.params : {};
    for (const paramSpec of Object.values(params)) {
      const normalized = paramSpec && typeof paramSpec === "object" ? paramSpec : {};
      const key = String(normalized?.key || "").trim();
      if (!key) continue;
      flat[key] = normalized?.text;
    }

    const texts = spec?.texts && typeof spec.texts === "object" ? spec.texts : {};
    for (const [key, value] of Object.entries(texts)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) continue;
      flat[normalizedKey] = value;
    }
  }
  return flat;
}

export const TOOL_SCHEMA_BY_TOOL = {
  ...CONNECTOR_TOOL_SCHEMA,
  ...FILE_TOOL_SCHEMA,
  ...TASK_ORCHESTRATION_TOOL_SCHEMA,
  ...CONTENT_TOOL_SCHEMA,
  ...INVOCATION_TOOL_SCHEMA,
  ...ASSISTANCE_TOOL_SCHEMA,
};

export const TOOL_SCHEMA_FLAT_GENERATED = buildToolSchemaFlat(TOOL_SCHEMA_BY_TOOL);
