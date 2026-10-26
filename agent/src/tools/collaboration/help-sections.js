/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { PATH_VIEWS, isHostFilesystemSentinel } from "@noobot/path-resolver";
import { resolveAgentRuntimePathContext } from "../../context/runtime-path-context.js";
import {
  EXECUTION_ISOLATION_MODE,
  TOOL_EXECUTION_CLASS,
  TOOL_EXECUTION_REGISTRY,
} from "@noobot/execution-isolation-protocol";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { MEMORY_RELATIVE_PATHS } from "../../memory/storage/paths.js";
import { ATTACHMENT_SOURCE, formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import { resolveToolBindings } from "@noobot/agent-config-protocol";
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
  getToolsFromAgentContext,
} from "../../context/agent-context-accessor.js";
import { getAgentContextEnvelope } from "../../context/agent-execution-scope.js";
import { mergeConfig } from "../../config/index.js";
import { resolveModelSection } from "../../context/providers/model-provider.js";
import { text } from "@noobot/shared/value";
import { AGENT_CONTEXT_IDENTITY_SHAPE } from "@noobot/context-protocol/agent-context/schema";

export const TOOL_SOURCE = Object.freeze({
  RUNTIME_BINDINGS: "runtime_bindings",
  UNAVAILABLE: "unavailable",
});

export const EXPERIENCE_PATH_FIELDS = Object.freeze({
  experienceDir: MEMORY_RELATIVE_PATHS.EXPERIENCE_DIR,
  experienceModelPath: MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL,
  experienceFieldsPath: MEMORY_RELATIVE_PATHS.EXPERIENCE_FIELDS,
});

export const MEMORY_PATH_FIELDS = Object.freeze({
  memoryDir: MEMORY_RELATIVE_PATHS.MEMORY_DIR,
  longMemoryPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY,
  longMemoryModelPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY_MODEL,
  shortMemoryPath: MEMORY_RELATIVE_PATHS.SHORT_MEMORY,
  dailySummaryDir: MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR,
  weeklySummaryDir: MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR,
  monthlySummaryDir: MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR,
  yearlySummaryDir: MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR,
});

const RUN_INSTANCE_IDENTITY_FIELDS = Object.freeze(["runId", "presentationMessageId"]);
const CONTEXT_IDENTITY_FIELDS = Object.freeze(
  Object.keys(AGENT_CONTEXT_IDENTITY_SHAPE).filter(
    (field) => !RUN_INSTANCE_IDENTITY_FIELDS.includes(field),
  ),
);

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
  const { view, directories, sandbox } = resolveAgentRuntimePathContext(
    getRuntimeFromAgentContext(agentContext),
    "execute_script",
  );
  const directoryRefs = Object.fromEntries(
    RUNTIME_DIRECTORY_FIELDS.map((field) => [field, projectToolPathRef(directories[field])]),
  );
  const allowedRoots = directories.allowedRoots.map((item) =>
    isHostFilesystemSentinel(item)
      ? Object.freeze({ view: PATH_VIEWS.HOST, scope: item })
      : projectToolPathRef(item),
  );
  const extraMountTargets = directories.extraMountTargets.map(projectToolPathRef);
  return {
    view,
    relativePathBase: directories.relativePathBase,
    directories: directoryRefs,
    allowedRoots,
    extraMountTargets,
    sandbox: sandbox
      ? {
          enabled: true,
          provider: sandbox.provider,
          scope: sandbox.scope,
          root: projectToolPathRef(sandbox.root),
          pathMappings: sandbox.pathMappings.map((item) => ({
            source: projectToolPathRef(item.source),
            target: projectToolPathRef(item.target),
          })),
        }
      : { enabled: false },
  };
}

export function buildContextSection(agentContext) {
  const { environment, execution } = getAgentContextEnvelope(agentContext);
  const sessionIds = getSessionIdsFromAgentContext(agentContext);
  const identity = Object.fromEntries(
    CONTEXT_IDENTITY_FIELDS.map((field) => [field, sessionIds[field]]),
  );
  return {
    identity,
    caller: execution.caller,
    timestamp: execution.timestamp,
    isSuperUser: environment.permissions.isSuperUser,
  };
}

export function resolveAvailableTools(agentContext) {
  try {
    const runtime = getRuntimeFromAgentContext(agentContext);
    const tools = resolveToolBindings({
      sourceTools: getToolsFromAgentContext(agentContext),
      runConfig: runtime?.runConfig,
    });
    const toolNames = [
      ...new Set(
        tools
          .map((tool) => text(tool?.name))
          .filter((name) => name)
          .sort(),
      ),
    ];
    return { toolNames, source: TOOL_SOURCE.RUNTIME_BINDINGS };
  } catch {
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

export function buildModelsSection(agentContext) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};
  const runConfig = runtime?.runConfig || {};
  return resolveModelSection({
    globalConfig,
    userConfig,
    effectiveConfig: mergeConfig(globalConfig, userConfig),
    selectedModel: runConfig.selectedModel,
    scenario: runConfig.scenario,
  });
}

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
