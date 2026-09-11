/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import {
  PATH_VIEWS,
  isHostFilesystemSentinel,
  resolveAgentPathContext,
} from "@noobot/path-resolver";
import {
  EXECUTION_ISOLATION_MODE,
  TOOL_EXECUTION_CLASS,
  TOOL_EXECUTION_REGISTRY,
  WORKSPACE_SANDBOX_PATHS,
  resolveToolExecutionPolicy,
} from "@noobot/execution-isolation-protocol";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { MEMORY_RELATIVE_PATHS } from "../../memory/storage/paths.js";
import { ATTACHMENT_SOURCE, formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getSystemRuntimeFromAgentContext,
  getToolsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { mergeConfig } from "../../config/index.js";
import { resolveModelSection } from "../../context/providers/model-provider.js";

export const TOOL_SOURCE = Object.freeze({
  RUNTIME_BINDINGS: "runtime_bindings",
  UNAVAILABLE: "unavailable",
});

export const EXPERIENCE_PATH_FIELDS = Object.freeze({
  experienceDir: MEMORY_RELATIVE_PATHS.EXPERIENCE_DIR,
  experienceModelPath: MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL,
});

export const MEMORY_PATH_FIELDS = Object.freeze({
  memoryDir: MEMORY_RELATIVE_PATHS.MEMORY_DIR,
  longMemoryPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY,
  longMemoryMetadataPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY_METADATA,
  longMemoryModelPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY_MODEL,
  shortMemoryPath: MEMORY_RELATIVE_PATHS.SHORT_MEMORY,
  dailySummaryDir: MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR,
  weeklySummaryDir: MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR,
  monthlySummaryDir: MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR,
  yearlySummaryDir: MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR,
});

const CONTEXT_IDENTITY_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "rootSessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
]);

const RUNTIME_DIRECTORY_FIELDS = Object.freeze(["currentDirectory", "rootDirectory", "opsWorkdir"]);

export const ATTACHMENT_SOURCES = Object.freeze(Object.values(ATTACHMENT_SOURCE));

export function projectPathFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([field, relativePath]) => [
      field,
      projectToolPathRef(relativePath),
    ]),
  );
}

export function buildRuntimeSection(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const globalConfig = runtime?.globalConfig || {};
  const executionPolicy = resolveToolExecutionPolicy({ toolName: "execute_script", globalConfig });
  const pathContext = resolveAgentPathContext({
    runtime,
    agentContext,
    globalConfig,
    executionPolicy,
  });

  const directories = Object.fromEntries(
    RUNTIME_DIRECTORY_FIELDS.filter((field) => pathContext[field]).map((field) => [
      field,
      projectToolPathRef(pathContext[field]),
    ]),
  );
  // <host-filesystem> 是 path-resolver 的哨兵值而非真实路径，不能过 projectToolPathRef 投影。
  const allowedRoots = (pathContext.allowedRoots || []).map((item) =>
    isHostFilesystemSentinel(item)
      ? Object.freeze({ view: PATH_VIEWS.HOST, scope: item })
      : projectToolPathRef(item),
  );
  const extraMountTargets = (pathContext.extraMountTargets || []).map((item) =>
    projectToolPathRef(item),
  );
  const sandboxPathMappings = (pathContext.sandboxPathMappings || []).map((item = {}) => ({
    source: projectToolPathRef(item.source || ""),
    target: projectToolPathRef(item.target || ""),
  }));
  const sandboxEnabled = pathContext.sandboxEnabled === true;

  return {
    view: pathContext.view,
    relativePathBase: pathContext.relativePathBase,
    directories,
    allowedRoots,
    ...(extraMountTargets.length ? { extraMountTargets } : {}),
    sandbox: {
      enabled: sandboxEnabled,
      ...(sandboxEnabled
        ? {
            provider: pathContext.sandboxProvider,
            scope: pathContext.sandboxScope,
            root: projectToolPathRef(pathContext.sandboxRoot || WORKSPACE_SANDBOX_PATHS.ROOT),
            pathMappings: sandboxPathMappings,
          }
        : {}),
    },
  };
}

export function buildContextSection(agentContext) {
  const systemRuntime = getSystemRuntimeFromAgentContext(agentContext);
  const sessionIds = getSessionIdsFromAgentContext(agentContext);
  const identity = Object.fromEntries(
    CONTEXT_IDENTITY_FIELDS.map((field) => [
      field,
      String(systemRuntime?.[field] || sessionIds?.[field] || "").trim(),
    ]).filter(([, value]) => value),
  );
  return {
    identity,
    caller: String(systemRuntime?.caller || "").trim(),
    timestamp: String(systemRuntime?.now || "").trim(),
    isSuperUser: systemRuntime?.isSuperUser === true,
  };
}

// 可用工具集的唯一事实源是 bindings.tools：它是 buildToolsDefault 五层门控（多模态 provider
// 探测、allowUserInteraction、插件追加、按 config enabled 过滤、子 Agent 深度剔除）之后，
// 再经 resolveToolBindings 按 runConfig 二次收窄的最终装配结果，并已包含 harness 的整体覆盖。
// 静态的 TOOL_NAME 注册表与 i18n 手册键都是全集，不能代表本次会话真实可调用的工具。
export function resolveAvailableTools(agentContext) {
  try {
    const tools = getToolsFromAgentContext(agentContext);
    const toolNames = [
      ...new Set(
        tools
          .map((tool) => String(tool?.name || "").trim())
          .filter((name) => name)
          .sort(),
      ),
    ];
    return { toolNames, source: TOOL_SOURCE.RUNTIME_BINDINGS };
  } catch {
    // bindings.tools 缺失时既不能把静态全集伪装成可用集，也不能声称读到了别的来源，
    // 只能如实标注来源不可用，由调用方决定如何呈现。
    return { toolNames: [], source: TOOL_SOURCE.UNAVAILABLE };
  }
}

export function buildIsolationSection(availableToolNames = []) {
  const available = new Set(availableToolNames);
  const toolsByExecutionClass = Object.fromEntries(
    Object.values(TOOL_EXECUTION_CLASS).map((executionClass) => [
      executionClass,
      Object.entries(TOOL_EXECUTION_REGISTRY)
        .filter(([toolName, value]) => value === executionClass && available.has(toolName))
        .map(([toolName]) => toolName),
    ]),
  );
  return {
    modes: Object.values(EXECUTION_ISOLATION_MODE),
    executionClasses: Object.values(TOOL_EXECUTION_CLASS),
    toolsByExecutionClass,
  };
}

// 模型信息复用 resolveModelSection 这一唯一事实源：其 available 已按 providers[].enabled !== false
// 过滤，与运行时真实可用模型对齐；effectiveConfig 全仓无持久挂载，按工具层既有惯例就地派生。
export function buildModelsSection(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  return resolveModelSection({
    globalConfig,
    userConfig,
    effectiveConfig: mergeConfig(globalConfig, userConfig),
  });
}

// tool-json-result.js 的模型投影层约定附件只能有唯一一种表示形态：裸的
// attachmentId/sessionId/attachmentSource 三字段与 attachmentRef 不得同层，否则抛
// mixed_attachment_identity_representations；且任一身份字段单独出现即要求三字段齐全，
// 否则抛 incomplete_attachment_identity。因此这里只输出 attachmentRef，不保留裸身份字段。
//
// attachmentRef 走 formatAttachmentIdentityRef 直出扁平字符串，与 parsed-artifact-persistence.js
// 的既有约定一致；不套 projectToolPathRef，否则模型投影层会把内层 identity 再压成同名键。
const ATTACHMENT_META_FIELDS = Object.freeze([
  "name",
  "mimeType",
  "size",
  "createdAt",
  "contentSha256",
  "generatedByModel",
  "generationSource",
]);

export function projectAttachmentRecord(record = {}) {
  const meta = Object.fromEntries(
    ATTACHMENT_META_FIELDS.filter(
      (field) => record[field] !== undefined && record[field] !== null,
    ).map((field) => [field, record[field]]),
  );
  return {
    ...meta,
    ...(record.relativePath ? { pathRef: projectToolPathRef(record.relativePath) } : {}),
    attachmentRef: formatAttachmentIdentityRef({
      attachmentId: record.attachmentId,
      sessionId: record.sessionId,
      attachmentSource: record.attachmentSource,
    }),
  };
}
