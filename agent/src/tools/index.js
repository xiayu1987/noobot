/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createFileTool } from "./execution/file-tools.js";
import { createScriptTool } from "./execution/script-tool.js";
import { createNativeScriptTool } from "./execution/native-script-tool.js";
import { createSkillTool } from "./execution/skill-tool.js";
import { createServiceTool } from "./execution/service-tool.js";
import { createModelTool } from "./ai-models/model-tool.js";
import { createUserInteractionTool } from "./collaboration/user-interaction-tool.js";
import { createMcpTool } from "./execution/mcp-tool.js";
import { createConnectorAccessTool } from "./connectors/connector-access-tool.js";
import { createWebSearchTool } from "./ai-models/web-search-tool.js";
import { createMultimodalGenerateTool } from "./ai-models/multimodal-generate-tool.js";
import { createMultimodalParseTool } from "./ai-models/multimodal-parse-tool.js";
import { createTaskSummaryTool } from "./collaboration/task-summary-tool.js";
import { createTaskCheckTool } from "./collaboration/task-check-tool.js";
import { createHelpTool } from "./collaboration/help-tool.js";
import { mergeConfig } from "../config/index.js";
import { CONTROL_TOOL_NAMES } from "./constants/index.js";
import { runBuildToolsAdapter } from "./adapter.js";
export { renderTaskSummaryReceiptMessage } from "./collaboration/task-summary-tool.js";
import { assertToolPathContract } from "@noobot/path-resolver";
import {
  MODEL_MULTIMODAL_MODALITY,
  supportsModelMultimodalGeneration,
  supportsModelMultimodalParsing,
} from "@noobot/model-protocol";
import { getRuntimeFromAgentContext } from "../context/agent-context-accessor.js";
import { text, isObjectLike } from "@noobot/shared/value";
export {
  setToolBuilderAdapter,
  getToolBuilderAdapter,
  resetToolBuilderAdapter,
} from "./adapter.js";

function isNamedToolEnabled(effectiveConfig = {}, toolName = "", defaultEnabled = true) {
  const normalized = text(toolName);
  if (!normalized) return defaultEnabled;
  const toolConfig = effectiveConfig?.tools?.[normalized];
  if (!isObjectLike(toolConfig)) return defaultEnabled;
  return toolConfig.enabled !== false;
}

function normalizeToolName(toolDefinition = {}) {
  return text(toolDefinition?.name);
}

function filterToolsByConfigEnabled(tools = [], effectiveConfig = {}) {
  const source = Array.isArray(tools) ? tools : [];
  return source.filter((toolDefinition) => {
    const name = normalizeToolName(toolDefinition);
    if (CONTROL_TOOL_NAMES.includes(name)) return true;
    return isNamedToolEnabled(effectiveConfig, name, true);
  });
}

function hasEnabledMultimodalGenerationProvider(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.values(providers).some(
    (providerConfig) =>
      providerConfig?.enabled !== false &&
      supportsModelMultimodalGeneration(providerConfig, [MODEL_MULTIMODAL_MODALITY.IMAGE]),
  );
}

function hasEnabledMultimodalParsingProvider(effectiveConfig = {}) {
  const providers = effectiveConfig?.providers || {};
  return Object.values(providers).some(
    (providerConfig) =>
      providerConfig?.enabled !== false && supportsModelMultimodalParsing(providerConfig),
  );
}

async function buildToolsDefault(ctx) {
  const runtime = getRuntimeFromAgentContext(ctx.agentContext);
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  const { allowUserInteraction } = runtime.systemRuntime.config;
  const enableMultimodalGenerateTool = hasEnabledMultimodalGenerationProvider(effectiveConfig);
  const enableMultimodalParseTool = hasEnabledMultimodalParsingProvider(effectiveConfig);
  const baseTools = [
    ...createFileTool(ctx),
    ...createScriptTool(ctx),
    ...createNativeScriptTool(ctx),
    ...createSkillTool(ctx),
    ...createServiceTool(ctx),
    ...createMcpTool(ctx),
    ...createWebSearchTool(ctx),
    ...(enableMultimodalGenerateTool ? createMultimodalGenerateTool(ctx) : []),
    ...(enableMultimodalParseTool ? createMultimodalParseTool(ctx) : []),
    ...createConnectorAccessTool(ctx),
    ...createModelTool(ctx),
    ...createTaskSummaryTool(ctx),
    ...createTaskCheckTool(ctx),
    ...createHelpTool(ctx),
    ...(allowUserInteraction ? createUserInteractionTool(ctx) : []),
  ];
  const pluginTools = (
    Array.isArray(runtime?.runConfig?.pluginTools) ? runtime.runConfig.pluginTools : []
  ).map((contribution) => {
    const tool = contribution.factory(ctx);
    const declaredName = text(contribution.name);
    if (!tool || text(tool.name) !== declaredName) {
      throw new TypeError(`plugin tool does not match its declaration: ${contribution.id}`);
    }
    return tool;
  });
  baseTools.push(...pluginTools);
  const enabledTools = filterToolsByConfigEnabled(baseTools, effectiveConfig);
  for (const tool of enabledTools) {
    if (tool?.metadata?.pathContract) assertToolPathContract(tool.metadata.pathContract);
  }
  return enabledTools;
}

export async function buildTools(ctx) {
  return runBuildToolsAdapter(ctx, buildToolsDefault);
}
