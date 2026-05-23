/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  ACCEPTANCE_MODE,
  CAPABILITY_DOMAIN,
  LOCALE,
  TASK_ACCEPTANCE_TOOL_NAME,
  appendCapabilityLog,
  ensureHarnessBucket,
  translateI18nText,
} from "./deps.js";
import { buildAcceptanceReport } from "./report-builder.js";
import { runAcceptanceBySeparateModel } from "./validation-runner.js";

function createRequestTaskAcceptanceTool({ bucket = {}, state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  return new DynamicStructuredTool({
    name: TASK_ACCEPTANCE_TOOL_NAME,
    description: translateI18nText(locale, "taskAcceptanceToolDescription"),
    schema: z.object({
      mode: z
        .enum([ACCEPTANCE_MODE.ACTIVE, ACCEPTANCE_MODE.FORCED])
        .optional()
        .describe(translateI18nText(locale, "taskAcceptanceModeDescription")),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const toolMeta = config?.configurable?.noobotHookMeta || meta;
      const requestedMode = String(args?.mode || ACCEPTANCE_MODE.ACTIVE).trim().toLowerCase();
      const mode = requestedMode === ACCEPTANCE_MODE.FORCED ? ACCEPTANCE_MODE.FORCED : ACCEPTANCE_MODE.ACTIVE;
      state.flags.acceptanceRequested = true;
      const report = buildAcceptanceReport({ bucket, state, mode });
      bucket.lastAcceptanceReport = report;
      bucket.acceptanceReports.push(report);
      await runAcceptanceBySeparateModel(toolCtx, toolMeta, report);
      return {
        ok: true,
        status: "completed",
        tool: TASK_ACCEPTANCE_TOOL_NAME,
        report,
      };
    },
  });
}

export function ensureTaskAcceptanceTool(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  if (registry.some((tool) => String(tool?.name || "").trim() === TASK_ACCEPTANCE_TOOL_NAME)) {
    return false;
  }
  registry.push(createRequestTaskAcceptanceTool({ bucket, state, ctx, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: "task_acceptance_tool_injected",
  });
  return true;
}
