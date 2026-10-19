/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { runPlanningRefinementBySeparateModel } from "./refinement-runner.js";
import {
  CAPABILITY_DOMAIN,
  HARNESS_I18N_KEYSET,
  LOCALE,
  PLAN_REFINEMENT_TOOL_NAME,
  appendCapabilityLog,
  clearPendingPlanRefinement,
  ensureHarnessBucket,
  shouldUseSeparateModel,
  syncPlanRefinementPolicyFlag,
  translateI18nText,
} from "./deps.js";
import { requireToolHookContext } from "../shared/tool-hook-context.js";
import {
  FLOW_CONTROL_ROLE,
  createFlowControlContextPolicy,
} from "@noobot/context-protocol/tool/context-policy";
import { text } from "@noobot/shared/value";

const PLANNING_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

function createPlanRefinementTool({ state, meta }) {
  const locale = state.locale || LOCALE.ZH_CN;
  return structuredTool(
    async (args, config) => {
      const toolCtx = requireToolHookContext(config);
      const toolMeta = meta.harness.bindSignal(config.signal);
      if (state.flags.planningCaptured !== true) {
        return {
          ok: false,
          status: "not_ready",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.NOT_READY_REASON,
          ),
        };
      }
      if (syncPlanRefinementPolicyFlag(toolCtx, state, toolMeta) !== true) {
        clearPendingPlanRefinement(state);
        return {
          ok: false,
          status: "disabled",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: "plan_refinement_disabled",
        };
      }
      if (state.flags.planRefinementRequested === true) {
        throw new Error("request_plan_refinement may be called only once per agent turn");
      }
      state.flags.planRefinementRequested = true;
      synchronizePlanRefinementTool(toolCtx, toolMeta);
      const refinementResult = await runPlanningRefinementBySeparateModel(toolCtx, toolMeta, {
        source: "planning_refinement_tool",
        targetMainStepIndexes: args.targetMainStepIndexes ?? [],
      });
      if (refinementResult?.status === "converged") {
        return {
          ok: false,
          status: "converged",
          tool: PLAN_REFINEMENT_TOOL_NAME,
          reason: translateI18nText(
            locale,
            HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.CONVERGED_REASON,
          ),
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
        targetMainStepIndexes: refinementResult.targetMainStepIndexes,
      };
    },
    {
      name: PLAN_REFINEMENT_TOOL_NAME,
      description: translateI18nText(locale, HARNESS_I18N_KEYSET.PLAN_REFINEMENT_TOOL.DESCRIPTION),
      schema: z.object({
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
      metadata: {
        contextPolicy: createFlowControlContextPolicy(FLOW_CONTROL_ROLE.CHECKPOINT_EVIDENCE),
      },
    },
  );
}

export function synchronizePlanRefinementTool(ctx, meta) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) throw new TypeError("synchronizePlanRefinementTool requires ctx.agentContext");
  const { state } = holder;
  if (!shouldUseSeparateModel(meta) || syncPlanRefinementPolicyFlag(ctx, state, meta) !== true) {
    clearPendingPlanRefinement(state);
    return false;
  }
  const registry = ctx.agentContext.bindings.tools;
  if (state.flags.planRefinementRequested === true) {
    const next = registry.filter((tool) => text(tool?.name) !== PLAN_REFINEMENT_TOOL_NAME);
    if (next.length === registry.length) return false;
    registry.splice(0, registry.length, ...next);
    return true;
  }
  if (registry.some((tool) => text(tool?.name) === PLAN_REFINEMENT_TOOL_NAME)) {
    return false;
  }
  registry.push(createPlanRefinementTool({ state, meta }));
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.PLANNING,
    event: PLANNING_EVENTS.refinementToolInjected,
  });
  return true;
}
