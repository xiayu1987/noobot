/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { runPlanningRefinementBySeparateModel } from "./refinement-runner.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  PLAN_REFINEMENT_TOOL_NAME,
  appendCapabilityLog,
  ensureHarnessBucket,
} from "./deps.js";

function createPlanRefinementTool({ state = {}, ctx = {}, meta = {} } = {}) {
  const locale = state?.locale || LOCALE.ZH_CN;
  const modeDescription =
    locale === LOCALE.EN_US
      ? "Optional summary text used as refinement context."
      : "可选的小结文本，会作为计划细化上下文。";
  return new DynamicStructuredTool({
    name: PLAN_REFINEMENT_TOOL_NAME,
    description:
      locale === LOCALE.EN_US
        ? "Trigger planning refinement flow after main plan is ready."
        : "在总计划完成后触发计划细化流程。",
    schema: z.object({
      summary: z.string().optional().describe(modeDescription),
    }),
    async func(args = {}, _runManager = null, config = {}) {
      const toolCtx = config?.configurable?.noobotHookContext || ctx;
      const toolMeta = config?.configurable?.noobotHookMeta || meta;
      const summaryText = String(args?.summary || "").trim();
      if (state?.flags?.planningCaptured !== true) {
        return {
          ok: false,
          status: "not_ready",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason:
            locale === LOCALE.EN_US
              ? "main planning flow is not completed yet"
              : "总计划流程尚未完成",
        };
      }
      const refinementResult = await runPlanningRefinementBySeparateModel(
        toolCtx,
        toolMeta,
        {
          summaryText,
          source: "planning_refinement_tool",
        },
      );
      if (refinementResult?.status === "converged") {
        return {
          ok: false,
          status: "converged",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason:
            locale === LOCALE.EN_US
              ? "no refinable main step found"
              : "未找到可细化的主步骤",
        };
      }
      if (refinementResult?.applied !== true) {
        return {
          ok: false,
          status: String(refinementResult?.status || "failed"),
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason:
            locale === LOCALE.EN_US
              ? "plugin-side refinement failed"
              : "插件侧细化失败",
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
    event: "planning_refinement_tool_injected",
  });
  return true;
}

