/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { runPlanningRefinementBySeparateModel } from "./refinement-runner.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  PLAN_REFINEMENT_TOOL_NAME,
  appendCapabilityLog,
  ensureHarnessBucket,
  translateI18nText,
} from "./deps.js";
import { resolveToolHookMeta } from "../shared/tool-hook-meta.js";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

function createPlanRefinementTool({ state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  return new DynamicStructuredTool({
    name: PLAN_REFINEMENT_TOOL_NAME,
    description: translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.DESCRIPTION),
    schema: z.object({
      summary: z
        .string()
        .optional()
        .describe(translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.SUMMARY_DESCRIPTION)),
      targetMainStepIndexes: z
        .array(z.number().int().positive())
        .optional()
        .describe(
          translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.TARGET_MAIN_STEP_INDEXES_DESCRIPTION,
          ),
        ),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const toolMeta = resolveToolHookMeta(config?.configurable?.noobotHookMeta, meta);
      const summaryText = String(args?.summary || "").trim();
      if (state?.flags?.planningCaptured !== true) {
        return {
          ok: false,
          status: "not_ready",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.NOT_READY_REASON),
        };
      }
      const refinementResult = await runPlanningRefinementBySeparateModel(
        toolCtx,
        toolMeta,
        {
          summaryText,
          source: "planning_refinement_tool",
          targetMainStepIndexes: Array.isArray(args?.targetMainStepIndexes)
            ? args.targetMainStepIndexes
            : [],
        },
      );
      if (refinementResult?.status === "converged") {
        return {
          ok: false,
          status: "converged",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.CONVERGED_REASON),
        };
      }
      if (refinementResult?.applied !== true) {
        return {
          ok: false,
          status: String(refinementResult?.status || "failed"),
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.FAILED_REASON),
        };
      }
      return {
        ok: true,
        status: "completed",
        tool: PLAN_REFINEMENT_TOOL_NAME,
        stage: "refinement",
        targetMainStepIndexes: Array.isArray(refinementResult?.targetMainStepIndexes)
          ? refinementResult.targetMainStepIndexes
          : [],
      };
    },
  });
}

export function ensurePlanRefinementTool(ctx = {}, meta = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  if (state?.flags?.planningCaptured !== true) return false;
  const registry = ctx?.agentContext?.payload?.tools?.registry;
  if (!Array.isArray(registry)) return false;
  if (registry.some((tool) => String(tool?.name || "").trim() === PLAN_REFINEMENT_TOOL_NAME)) {
    return false;
  }
  registry.push(createPlanRefinementTool({ state, ctx, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: PLANNING_EVENTS.refinementToolInjected,
  });
  return true;
}
