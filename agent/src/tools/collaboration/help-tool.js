/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { filePath as path } from "@noobot/path-resolver";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { listManualToolNames, tToolManual } from "../core/tool-schema-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

export const HELP_TOOL_NAME = TOOL_NAME.HELP;

export const HELP_TYPES = Object.freeze({
  TOOL: "tool",
  EXPERIENCE: "experience",
});

const MEMORY_PATHS = Object.freeze({
  MEMORY_DIR: "memory",
  LONG_MEMORY: "long-memory.md",
  LONG_MEMORY_METADATA: "long-memory/metadata.md",
  SHORT_MEMORY: "short-memory.json",
  LONG_MEMORY_MODEL: "long-memory-model.md",
  EXPERIENCE_MODEL: "experience-model.md",
  EXPERIENCE_DIR: "experience",
  DAILY_SUMMARY_DIR: "daily_summary",
  WEEKLY_SUMMARY_DIR: "weekly_summary",
  MONTHLY_SUMMARY_DIR: "monthly_summary",
  YEARLY_SUMMARY_DIR: "yearly_summary",
});

function normalizeName(value = "") {
  return String(value || "").trim();
}

function resolveWorkspaceBasePath(agentContext = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  return normalizeName(
    agentContext?.context?.environment?.workspace?.basePath || runtime?.basePath || "",
  );
}

function projectMemoryPath(basePath = "", ...segments) {
  return projectToolPathRef(path.join(basePath, ...segments));
}

function resolveMemoryHelpPaths(agentContext = {}) {
  const basePath = resolveWorkspaceBasePath(agentContext);
  if (!basePath) return null;
  const memoryDir = path.join(basePath, MEMORY_PATHS.MEMORY_DIR);
  return {
    memoryDir: projectToolPathRef(memoryDir),
    longMemoryPath: projectMemoryPath(memoryDir, MEMORY_PATHS.LONG_MEMORY),
    longMemoryMetadataPath: projectMemoryPath(memoryDir, MEMORY_PATHS.LONG_MEMORY_METADATA),
    shortMemoryPath: projectMemoryPath(memoryDir, MEMORY_PATHS.SHORT_MEMORY),
    longMemoryModelPath: projectMemoryPath(memoryDir, MEMORY_PATHS.LONG_MEMORY_MODEL),
    experienceModelPath: projectMemoryPath(memoryDir, MEMORY_PATHS.EXPERIENCE_MODEL),
    experienceDir: projectMemoryPath(memoryDir, MEMORY_PATHS.EXPERIENCE_DIR),
    dailySummaryDir: projectMemoryPath(memoryDir, MEMORY_PATHS.DAILY_SUMMARY_DIR),
    weeklySummaryDir: projectMemoryPath(memoryDir, MEMORY_PATHS.WEEKLY_SUMMARY_DIR),
    monthlySummaryDir: projectMemoryPath(memoryDir, MEMORY_PATHS.MONTHLY_SUMMARY_DIR),
    yearlySummaryDir: projectMemoryPath(memoryDir, MEMORY_PATHS.YEARLY_SUMMARY_DIR),
  };
}

function buildToolManualResult({ runtime, toolName }) {
  const manualToolNames = listManualToolNames(runtime);
  const normalizedToolName = normalizeName(toolName);
  if (!normalizedToolName) {
    return {
      ok: true,
      status: TOOL_RESULT_STATUS.COMPLETED,
      helpType: HELP_TYPES.TOOL,
      toolNames: manualToolNames,
    };
  }
  const manual = tToolManual(runtime, normalizedToolName);
  if (manual) {
    return {
      ok: true,
      status: TOOL_RESULT_STATUS.COMPLETED,
      helpType: HELP_TYPES.TOOL,
      toolName: normalizedToolName,
      manual,
    };
  }
  const isRegisteredTool = Object.values(TOOL_NAME).includes(normalizedToolName);
  return {
    ok: true,
    status: TOOL_RESULT_STATUS.COMPLETED,
    helpType: HELP_TYPES.TOOL,
    toolName: normalizedToolName,
    manual: null,
    reason: isRegisteredTool
      ? tTool(runtime, "tools.help.manualNotFound")
      : tTool(runtime, "tools.help.unknownTool"),
    toolNames: manualToolNames,
  };
}

function buildExperienceResult({ runtime, agentContext }) {
  const memoryHelpPaths = resolveMemoryHelpPaths(agentContext);
  if (!memoryHelpPaths) {
    return {
      ok: true,
      status: TOOL_RESULT_STATUS.COMPLETED,
      helpType: HELP_TYPES.EXPERIENCE,
      memoryHelpPaths: null,
      reason: tTool(runtime, "tools.help.workspaceUnavailable"),
    };
  }
  return {
    ok: true,
    status: TOOL_RESULT_STATUS.COMPLETED,
    helpType: HELP_TYPES.EXPERIENCE,
    hint: tTool(runtime, "tools.help.experienceHint"),
    memoryHelpPaths,
  };
}

export function createHelpTool({ agentContext } = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const helpTool = new DynamicStructuredTool({
    name: HELP_TOOL_NAME,
    description: tTool(runtime, "tools.help.description"),
    schema: z.object({
      helpType: z
        .enum([HELP_TYPES.TOOL, HELP_TYPES.EXPERIENCE])
        .optional()
        .default(HELP_TYPES.TOOL)
        .describe(tTool(runtime, "tools.help.fieldHelpType")),
      toolName: z.string().optional().describe(tTool(runtime, "tools.help.fieldToolName")),
    }),
    func: async ({ helpType, toolName }) => {
      const normalizedHelpType =
        normalizeName(helpType) === HELP_TYPES.EXPERIENCE
          ? HELP_TYPES.EXPERIENCE
          : HELP_TYPES.TOOL;
      const payload =
        normalizedHelpType === HELP_TYPES.EXPERIENCE
          ? buildExperienceResult({ runtime, agentContext })
          : buildToolManualResult({ runtime, toolName });
      return toToolJsonResult(HELP_TOOL_NAME, payload, true);
    },
  });
  return [helpTool];
}
