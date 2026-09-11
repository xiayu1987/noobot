/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { projectToolPathRef } from "../core/check-tool-input.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { listManualToolNames, tToolManual } from "../core/tool-schema-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";
import { MEMORY_RELATIVE_PATHS } from "../../memory/storage/paths.js";

export const HELP_TOOL_NAME = TOOL_NAME.HELP;

export const HELP_TYPES = Object.freeze({
  TOOL: "tool",
  EXPERIENCE: "experience",
});

function normalizeName(value = "") {
  return String(value || "").trim();
}

const MEMORY_HELP_PATH_FIELDS = Object.freeze({
  memoryDir: MEMORY_RELATIVE_PATHS.MEMORY_DIR,
  longMemoryPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY,
  longMemoryMetadataPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY_METADATA,
  shortMemoryPath: MEMORY_RELATIVE_PATHS.SHORT_MEMORY,
  longMemoryModelPath: MEMORY_RELATIVE_PATHS.LONG_MEMORY_MODEL,
  experienceModelPath: MEMORY_RELATIVE_PATHS.EXPERIENCE_MODEL,
  experienceDir: MEMORY_RELATIVE_PATHS.EXPERIENCE_DIR,
  dailySummaryDir: MEMORY_RELATIVE_PATHS.DAILY_SUMMARY_DIR,
  weeklySummaryDir: MEMORY_RELATIVE_PATHS.WEEKLY_SUMMARY_DIR,
  monthlySummaryDir: MEMORY_RELATIVE_PATHS.MONTHLY_SUMMARY_DIR,
  yearlySummaryDir: MEMORY_RELATIVE_PATHS.YEARLY_SUMMARY_DIR,
});

function resolveMemoryHelpPaths() {
  return Object.fromEntries(
    Object.entries(MEMORY_HELP_PATH_FIELDS).map(([field, relativePath]) => [
      field,
      projectToolPathRef(relativePath),
    ]),
  );
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

function buildExperienceResult({ runtime }) {
  return {
    ok: true,
    status: TOOL_RESULT_STATUS.COMPLETED,
    helpType: HELP_TYPES.EXPERIENCE,
    hint: tTool(runtime, "tools.help.experienceHint"),
    memoryHelpPaths: resolveMemoryHelpPaths(),
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
        normalizeName(helpType) === HELP_TYPES.EXPERIENCE ? HELP_TYPES.EXPERIENCE : HELP_TYPES.TOOL;
      const payload =
        normalizedHelpType === HELP_TYPES.EXPERIENCE
          ? buildExperienceResult({ runtime })
          : buildToolManualResult({ runtime, toolName });
      return toToolJsonResult(HELP_TOOL_NAME, payload, true);
    },
  });
  return [helpTool];
}
