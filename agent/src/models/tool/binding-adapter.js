/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_FAMILY_ID,
  resolveModelFamilyId,
  resolveModelStrictToolSchema,
} from "@noobot/model-protocol";
import { text, isObjectLike } from "@noobot/shared/value";

export const TOOL_BINDING_NAME_MAX_LENGTH = 64;
const TOOL_BINDING_NAME_PATTERN = new RegExp(`^[a-zA-Z0-9_-]{1,${TOOL_BINDING_NAME_MAX_LENGTH}}$`);
const STRICT_INCOMPATIBLE_TOOL_NAMES = new Set(["call_service"]);

function assertModelSpec(modelSpec) {
  if (!isObjectLike(modelSpec) || !text(modelSpec.model)) {
    throw new TypeError("adaptToolsForBinding requires a resolved model spec");
  }
}

function removeToolSearchDeferral(toolItem = {}) {
  if (
    !Object.prototype.hasOwnProperty.call(toolItem, "defer_loading") &&
    !Object.prototype.hasOwnProperty.call(toolItem, "deferLoading")
  ) {
    return toolItem;
  }
  const normalizedTool = Object.assign(Object.create(Object.getPrototypeOf(toolItem)), toolItem);
  delete normalizedTool.defer_loading;
  delete normalizedTool.deferLoading;
  return normalizedTool;
}

export function adaptToolsForBinding(tools, modelSpec) {
  assertModelSpec(modelSpec);
  const sourceTools = Array.isArray(tools) ? tools : [];
  const seenNames = new Set();
  const validTools = [];
  const droppedToolNames = [];
  const disableClaudeToolSearch = resolveModelFamilyId(modelSpec) === MODEL_FAMILY_ID.CLAUDE;

  for (const toolItem of sourceTools) {
    const toolName = text(toolItem?.name);
    const toolType = text(toolItem?.type).toLowerCase();
    if (
      disableClaudeToolSearch &&
      (toolName.toLowerCase() === "tool_search" || toolType.startsWith("tool_search"))
    ) {
      droppedToolNames.push(toolName || toolType || "tool_search");
      continue;
    }
    if (!toolName || !TOOL_BINDING_NAME_PATTERN.test(toolName)) {
      droppedToolNames.push(toolName || "(empty)");
      continue;
    }
    if (seenNames.has(toolName)) continue;
    seenNames.add(toolName);
    validTools.push(disableClaudeToolSearch ? removeToolSearchDeferral(toolItem) : toolItem);
  }
  validTools.sort((left, right) =>
    String(left?.name || "").localeCompare(String(right?.name || ""), "en"),
  );

  const strictByPolicy = resolveModelStrictToolSchema(modelSpec);
  const strictIncompatibleTools = validTools
    .map((t) => text(t?.name))
    .filter((n) => STRICT_INCOMPATIBLE_TOOL_NAMES.has(n));
  const strict = strictByPolicy && strictIncompatibleTools.length === 0;
  const toolChoice = "auto";
  const bindOptions = validTools.length
    ? {
        tool_choice: toolChoice,
        strict,
      }
    : {};

  return {
    tools: validTools,
    droppedToolNames,
    strictDowngradedTools: strictByPolicy && !strict ? strictIncompatibleTools : [],
    bindOptions,
  };
}
