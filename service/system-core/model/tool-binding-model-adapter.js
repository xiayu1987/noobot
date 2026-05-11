/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mergeConfig } from "../config/index.js";

const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const STRICT_INCOMPATIBLE_TOOL_NAMES = new Set(["call_service"]);

function isCodexLikeModel(modelName = "", modelAlias = "") {
  const modelToken = `${String(modelName || "").toLowerCase()} ${String(modelAlias || "").toLowerCase()}`;
  return modelToken.includes("codex") || modelToken.includes("gpt-5.3-codex");
}

function resolveStrictToolSchemaPolicy(modelState = {}) {
  const effectiveConfig = mergeConfig(
    modelState?.globalConfig || {},
    modelState?.userConfig || {},
  );
  const configuredStrict =
    effectiveConfig?.tools?.strict_tool_schema ??
    effectiveConfig?.tools?.strictToolSchema ??
    effectiveConfig?.tools?.binding?.strict ??
    effectiveConfig?.tools?.binding?.strictToolSchema;
  if (typeof configuredStrict === "boolean") return configuredStrict;
  return isCodexLikeModel(
    modelState?.activeModelName || "",
    modelState?.activeModelAlias || "",
  );
}

export function adaptToolsForBinding(tools = [], modelState = {}) {
  const sourceTools = Array.isArray(tools) ? tools : [];
  const seenNames = new Set();
  const validTools = [];
  const droppedToolNames = [];

  for (const toolItem of sourceTools) {
    const toolName = String(toolItem?.name || "").trim();
    if (!toolName || !OPENAI_TOOL_NAME_PATTERN.test(toolName)) {
      droppedToolNames.push(toolName || "(empty)");
      continue;
    }
    if (seenNames.has(toolName)) continue;
    seenNames.add(toolName);
    validTools.push(toolItem);
  }

  const strictByPolicy = resolveStrictToolSchemaPolicy(modelState);
  const strictIncompatibleTools = validTools
    .map((toolItem) => String(toolItem?.name || "").trim())
    .filter((toolName) => STRICT_INCOMPATIBLE_TOOL_NAMES.has(toolName));
  const strict = strictByPolicy && strictIncompatibleTools.length === 0;
  return {
    tools: validTools,
    droppedToolNames,
    strictDowngradedTools: strictByPolicy && !strict ? strictIncompatibleTools : [],
    bindOptions: strict ? { strict: true } : {},
  };
}
