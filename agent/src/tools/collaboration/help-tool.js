/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { tToolManual } from "../core/tool-schema-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import {
  HELP_COMMAND,
  HELP_COMMAND_NAMES,
  HELP_COMMAND_OPTIONS,
  HELP_COMMAND_USAGE,
} from "./help-command-contract.js";
import { parseHelpCommand } from "./help-command-parser.js";
import {
  ATTACHMENT_SOURCES,
  EXPERIENCE_PATH_FIELDS,
  MEMORY_PATH_FIELDS,
  buildContextSection,
  buildIsolationSection,
  buildModelsSection,
  buildRuntimeSection,
  projectAttachmentRecord,
  projectPathFields,
  resolveAvailableTools,
} from "./help-sections.js";

export const HELP_TOOL_NAME = TOOL_NAME.HELP;

function normalizeName(value = "") {
  return String(value || "").trim();
}

function completed(command, payload) {
  return { ok: true, status: TOOL_RESULT_STATUS.COMPLETED, command, ...payload };
}

function buildCommandIndex(runtime) {
  return completed("", {
    hint: tTool(runtime, "tools.help.commandIndexHint"),
    commands: HELP_COMMAND_NAMES.map((name) => ({
      command: `--${name}`,
      options: (HELP_COMMAND_OPTIONS[name] || []).map((option) => `--${option}`),
      description: tTool(runtime, `tools.help.command.${name}`),
    })),
    usage: [...HELP_COMMAND_USAGE],
  });
}

function buildToolsResult({ runtime, availableTools, options }) {
  const { toolNames, source } = availableTools;
  const toolName = normalizeName(options.name);
  if (!toolName) {
    return completed(HELP_COMMAND.TOOLS, { toolNames, toolSource: source });
  }
  // 手册存在与否和本次会话是否可调用是两件事：未装配的工具即使有手册也不应被当成可用。
  const isAvailable = toolNames.includes(toolName);
  const manual = isAvailable ? tToolManual(runtime, toolName) : null;
  // 字段名不能用 toolName：toToolJsonResult 先写工具身份再展开 payload，同名字段会污染身份。
  if (manual) {
    return completed(HELP_COMMAND.TOOLS, { queriedTool: toolName, manual });
  }
  const isRegisteredTool = Object.values(TOOL_NAME).includes(toolName);
  return completed(HELP_COMMAND.TOOLS, {
    queriedTool: toolName,
    manual: null,
    reason: isAvailable
      ? tTool(runtime, "tools.help.manualNotFound")
      : isRegisteredTool
        ? tTool(runtime, "tools.help.toolNotAvailable")
        : tTool(runtime, "tools.help.unknownTool"),
    toolNames,
    toolSource: source,
  });
}

function attachsFailure(runtime, reasonKey) {
  return {
    ok: false,
    status: TOOL_RESULT_STATUS.FAILED,
    command: HELP_COMMAND.ATTACHS,
    reason: tTool(runtime, reasonKey),
  };
}

async function buildAttachsResult({ runtime, agentContext, options }) {
  const attachmentService = runtime?.attachmentService || null;
  const { userId, sessionId } = buildContextSection(agentContext).identity;
  // 三种缺失的处置动作不同：服务缺失属运行时装配问题，身份缺失属会话上下文问题，压成一码会掩盖差异。
  if (!attachmentService) {
    return attachsFailure(runtime, "tools.help.attachmentServiceMissing");
  }
  if (!userId) {
    return attachsFailure(runtime, "tools.help.attachmentUserIdMissing");
  }
  if (!sessionId) {
    return attachsFailure(runtime, "tools.help.attachmentSessionIdMissing");
  }

  const requestedSource = normalizeName(options.source);
  if (requestedSource && !ATTACHMENT_SOURCES.includes(requestedSource)) {
    return {
      ok: false,
      status: TOOL_RESULT_STATUS.FAILED,
      command: HELP_COMMAND.ATTACHS,
      reason: tTool(runtime, "tools.help.unknownAttachmentSource"),
      attachmentSources: [...ATTACHMENT_SOURCES],
    };
  }
  const sources = requestedSource ? [requestedSource] : ATTACHMENT_SOURCES;

  const attachmentId = normalizeName(options.id);
  if (attachmentId) {
    for (const attachmentSource of sources) {
      const record = await attachmentService.getAttachmentById({
        userId,
        sessionId,
        attachmentSource,
        attachmentId,
      });
      if (record) {
        return completed(HELP_COMMAND.ATTACHS, { attachment: projectAttachmentRecord(record) });
      }
    }
    return {
      ok: false,
      status: TOOL_RESULT_STATUS.FAILED,
      command: HELP_COMMAND.ATTACHS,
      requestedAttachmentId: attachmentId,
      reason: tTool(runtime, "tools.help.attachmentNotFound"),
    };
  }

  const grouped = await Promise.all(
    sources.map(async (attachmentSource) => {
      const records = await attachmentService.readAttachmentMetas({
        userId,
        sessionId,
        attachmentSource,
      });
      // 字段名不能用 attachmentSource：模型投影层把裸身份字段视为附件身份对象并要求三字段齐全。
      return {
        source: attachmentSource,
        attachments: (records || []).map(projectAttachmentRecord),
      };
    }),
  );
  const bySource = grouped.filter((item) => item.attachments.length);
  return completed(HELP_COMMAND.ATTACHS, {
    sessionId,
    attachmentSources: [...ATTACHMENT_SOURCES],
    totalCount: bySource.reduce((sum, item) => sum + item.attachments.length, 0),
    bySource,
  });
}

function buildParseFailure(runtime, parsed) {
  const { reason, ...rest } = parsed;
  return {
    ok: false,
    status: TOOL_RESULT_STATUS.FAILED,
    ...rest,
    reason: tTool(runtime, `tools.help.parseError.${reason}`),
    commands: HELP_COMMAND_NAMES.map((name) => `--${name}`),
    usage: [...HELP_COMMAND_USAGE],
  };
}

async function dispatchHelpCommand({ runtime, agentContext, command, options }) {
  switch (command) {
    case HELP_COMMAND.TOOLS:
      return buildToolsResult({
        runtime,
        availableTools: resolveAvailableTools(agentContext),
        options,
      });
    case HELP_COMMAND.MODELS:
      // 与其余命令保持同一返回形态：段内字段平铺在根层，不额外包一层命令同名键。
      return completed(HELP_COMMAND.MODELS, buildModelsSection(agentContext));
    case HELP_COMMAND.EXPERIENCE:
      return completed(HELP_COMMAND.EXPERIENCE, {
        hint: tTool(runtime, "tools.help.experienceHint"),
        paths: projectPathFields(EXPERIENCE_PATH_FIELDS),
      });
    case HELP_COMMAND.MEMORY:
      return completed(HELP_COMMAND.MEMORY, {
        hint: tTool(runtime, "tools.help.memoryHint"),
        paths: projectPathFields(MEMORY_PATH_FIELDS),
      });
    case HELP_COMMAND.RUNTIME:
      return completed(HELP_COMMAND.RUNTIME, { runtime: buildRuntimeSection(agentContext) });
    case HELP_COMMAND.CONTEXT:
      return completed(HELP_COMMAND.CONTEXT, { context: buildContextSection(agentContext) });
    case HELP_COMMAND.ISOLATION: {
      const { toolNames, source } = resolveAvailableTools(agentContext);
      return completed(HELP_COMMAND.ISOLATION, {
        isolation: buildIsolationSection(toolNames),
        toolSource: source,
      });
    }
    case HELP_COMMAND.ATTACHS:
      return buildAttachsResult({ runtime, agentContext, options });
    default:
      return buildCommandIndex(runtime);
  }
}

export function createHelpTool({ agentContext } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const helpTool = new DynamicStructuredTool({
    name: HELP_TOOL_NAME,
    description: tTool(runtime, "tools.help.description"),
    schema: z.object({
      command: z.string().optional().describe(tTool(runtime, "tools.help.fieldCommand")),
    }),
    func: async ({ command }) => {
      const parsed = parseHelpCommand(command);
      const payload = parsed.ok
        ? await dispatchHelpCommand({
            runtime,
            agentContext,
            command: parsed.command,
            options: parsed.options,
          })
        : buildParseFailure(runtime, parsed);
      return toToolJsonResult(HELP_TOOL_NAME, payload, true);
    },
  });
  return [helpTool];
}
