/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  ACCEPTANCE_MODE,
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  TASK_ACCEPTANCE_TOOL_NAME,
  appendCapabilityLog,
  deferCapabilityLogs,
  ensureHarnessBucket,
  translateI18nText,
} from "./deps.js";
import { buildAcceptanceReport } from "./report-builder.js";
import { runAcceptanceBySeparateModel, runPhaseAcceptanceBySeparateModel } from "./validation-runner.js";
import { resolveToolHookMeta } from "../shared/tool-hook-meta.js";

const ACCEPTANCE_EVENTS = WORKFLOW_PARAMS.logging.events.acceptance;

function createRequestTaskAcceptanceTool({ bucket = {}, state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  return new DynamicStructuredTool({
    name: TASK_ACCEPTANCE_TOOL_NAME,
    description: translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.DESCRIPTION),
    schema: z.object({
      mode: z
        .enum([ACCEPTANCE_MODE.ACTIVE, ACCEPTANCE_MODE.FORCED])
        .optional()
        .describe(translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.MODE_DESCRIPTION)),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const capabilityLogStartIndex = Array.isArray(toolCtx.harnessCapabilityLogs)
        ? toolCtx.harnessCapabilityLogs.length
        : 0;
      const toolMeta = resolveToolHookMeta(config?.configurable?.noobotHookMeta, meta);
      const requestedMode = String(args?.mode || ACCEPTANCE_MODE.ACTIVE).trim().toLowerCase();
      const mode = requestedMode === ACCEPTANCE_MODE.FORCED ? ACCEPTANCE_MODE.FORCED : ACCEPTANCE_MODE.ACTIVE;
      state.flags.acceptanceRequested = true;
      const forcedReason =
        mode === ACCEPTANCE_MODE.FORCED
          ? state?.flags?.overflowForceAcceptancePending === true
            ? [
              translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.FORCED_REASON_OVERFLOW_IN_FLOW),
              translateI18nText(LOCALE.EN_US, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.FORCED_REASON_OVERFLOW_IN_FLOW),
            ].filter(Boolean).join(" | ")
            : [
              translateI18nText(locale, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.FORCED_REASON_TOOL_REQUESTED),
              translateI18nText(LOCALE.EN_US, HARNESS_I18N_KEYSET.ACCEPTANCE_TOOL.FORCED_REASON_TOOL_REQUESTED),
            ].filter(Boolean).join(" | ")
          : "";
      const phaseAcceptanceTriggered = await runPhaseAcceptanceBySeparateModel(
        toolCtx,
        toolMeta,
        { forceRun: true },
      );
      const report = buildAcceptanceReport({ bucket, state, ctx: toolCtx, mode, forcedReason });
      bucket.lastAcceptanceReport = report;
      bucket.acceptanceReports.push(report);
      await runAcceptanceBySeparateModel(toolCtx, toolMeta, report);
      const summary = report?.summary && typeof report.summary === "object" ? report.summary : {};
      const semanticValidation = report?.semanticValidation && typeof report.semanticValidation === "object"
        ? report.semanticValidation
        : {};
      state.flags.acceptanceCompleted =
        Number(summary.pending || 0) === 0 &&
        Number(summary.inProgress || 0) === 0 &&
        String(semanticValidation.status || "").trim().toLowerCase() !== "fail" &&
        semanticValidation.consistent !== false;
      deferCapabilityLogs(
        toolCtx,
        (Array.isArray(toolCtx.harnessCapabilityLogs) ? toolCtx.harnessCapabilityLogs : [])
          .slice(capabilityLogStartIndex),
      );
      return {
        ok: true,
        status: "completed",
        tool: TASK_ACCEPTANCE_TOOL_NAME,
        phaseAcceptanceTriggered,
        report,
      };
    },
  });
}

export function ensureTaskAcceptanceTool(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const registry = ctx?.agentContext?.bindings?.tools;
  if (!Array.isArray(registry)) return false;
  if (registry.some((tool) => String(tool?.name || "").trim() === TASK_ACCEPTANCE_TOOL_NAME)) {
    return false;
  }
  registry.push(createRequestTaskAcceptanceTool({ bucket, state, ctx, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: ACCEPTANCE_EVENTS.taskAcceptanceToolInjected,
  });
  return true;
}
