/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Tool binding adapter: validate names, deduplicate, resolve strict schema policy.
 */
import { mergeConfig } from "../../config/index.js";

const OPENAI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const STRICT_INCOMPATIBLE_TOOL_NAMES = new Set(["call_service"]);

/**
 * Check if the model is a Codex-like model.
 * @param {string} modelName
 * @param {string} modelAlias
 * @returns {boolean}
 */
function isCodexLikeModel(modelName = "", modelAlias = "") {
  const token = `${String(modelName || "").toLowerCase()} ${String(modelAlias || "").toLowerCase()}`;
  return token.includes("codex") || token.includes("gpt-5.3-codex");
}

/**
 * Resolve strict tool schema policy from config or model detection.
 * @param {object} modelState
 * @returns {boolean}
 */
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

/**
 * Adapt tools for model binding: validate, deduplicate, resolve strict mode.
 * @param {Array<object>} tools
 * @param {object} modelState
 * @returns {{ tools: Array<object>, droppedToolNames: string[], strictDowngradedTools: string[], bindOptions: object }}
 */
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
    .map((t) => String(t?.name || "").trim())
    .filter((n) => STRICT_INCOMPATIBLE_TOOL_NAMES.has(n));
  const strict = strictByPolicy && strictIncompatibleTools.length === 0;
  const toolChoice = "auto";
  const bindOptions = validTools.length
    ? {
        tool_choice: toolChoice,
        ...(strict ? { strict: true } : {}),
      }
    : {};

  return {
    tools: validTools,
    droppedToolNames,
    strictDowngradedTools:
      strictByPolicy && !strict ? strictIncompatibleTools : [],
    bindOptions,
  };
}
