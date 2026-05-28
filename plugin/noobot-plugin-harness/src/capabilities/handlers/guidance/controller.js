/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  ensureHarnessBucket,
  extractRawTextContent,
  resolveCapabilityModelInvoker,
  shouldUseSeparateModel,
} from "./deps.js";
import { isSummaryCompletionMarked } from "../model-response-parser.js";
import {
  schedulePlanUpdateByInject,
  maybeInjectPlanUpdatePrompt,
  maybeCapturePlanUpdateByInject,
} from "./revision-injector.js";
import { maybeInjectGuidanceOrSummaryPrompt } from "./prompt-injector.js";
import {
  runPendingPlanUpdateBySeparateModel,
  runPlanUpdateAfterSummary,
  runGuidanceBySeparateModel,
} from "./model-runner.js";
import { resolveGuidancePriorityDecision, resolveNextGuidanceAction } from "./plan-update-scheduler.js";
import { markGuidanceSummarizedMessages, markToolSignals, updateFailureCounters } from "./signal-tracker.js";
import { applySummaryText } from "./summary-manager.js";
import { appendCapabilityLog } from "../shared/attachment-log-utils.js";
import {
  appendWorkflowExecutionResult,
  appendWorkflowPriorityDecision,
  captureWorkflowLogCursor,
  resolveWorkflowExecutionMetrics,
  resolveWorkflowMode,
} from "../shared/workflow/pattern.js";
import { enforceWorkflowInvariants } from "../shared/workflow/invariants.js";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;

function resolveWorkflowActionName(action = "", stage = "") {
  if (action === "plan_update") {
    return String(stage || "").trim().toLowerCase() === "revision"
      ? "plan_update_revision"
      : "plan_update_refinement";
  }
  if (action === "summary") return "summary";
  if (action === "guidance") return "guidance";
  return "none";
}

async function executeGuidanceWorkflowAction({
  nextAction = { action: "none", stage: "", reason: "idle" },
  ctx = {},
  meta = {},
} = {}) {
  const mode = resolveWorkflowMode(meta);
  let changed = false;
  let executedPrimary = false;
  let executedFollowup = false;

  if (mode === "separate_model") {
    if (nextAction.action === "plan_update") {
      const firstChanged = await runPendingPlanUpdateBySeparateModel(ctx, meta);
      changed = firstChanged || changed;
      executedPrimary = firstChanged === true;
    }
    const followupChanged = await runGuidanceBySeparateModel(ctx, meta);
    changed = followupChanged || changed;
    executedFollowup = followupChanged === true;
  } else if (nextAction.action === "summary" || nextAction.action === "guidance") {
    const result = maybeInjectGuidanceOrSummaryPrompt(ctx);
    changed = result || changed;
    executedPrimary = result === true;
  } else if (nextAction.action === "plan_update") {
    const result = maybeInjectPlanUpdatePrompt(ctx);
    changed = result || changed;
    executedPrimary = result === true;
  }

  return {
    mode,
    changed,
    executedPrimary,
    executedFollowup,
    actionName: resolveWorkflowActionName(nextAction.action, nextAction.stage),
  };
}

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      changed = enforceWorkflowInvariants(ctx, { domain: CAPABILITY_DOMAIN.GUIDANCE }) || changed;
      const holder = ensureHarnessBucket(ctx);
      const startedAt = Date.now();
      const logCursor = captureWorkflowLogCursor(ctx, CAPABILITY_DOMAIN.GUIDANCE);
      const nextAction = resolveNextGuidanceAction(holder?.state || {});
      const decision = resolveGuidancePriorityDecision(holder?.state || {});
      const execution = await executeGuidanceWorkflowAction({
        nextAction,
        ctx,
        meta,
      });
      appendWorkflowPriorityDecision(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        point: "before_llm_call",
        mode: execution.mode,
        chosenAction: decision.chosenAction,
        chosenReason: decision.chosenReason,
        chosenStage: decision.chosenStage,
        blockedActions: decision.blockedActions,
        pending: decision.pendingSnapshot,
      });
      const metrics = resolveWorkflowExecutionMetrics(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        startCursor: logCursor,
      });
      appendWorkflowExecutionResult(ctx, {
        domain: CAPABILITY_DOMAIN.GUIDANCE,
        point: "before_llm_call",
        mode: execution.mode,
        chosenAction: decision.chosenAction,
        chosenReason: decision.chosenReason,
        requestedAction: execution.actionName,
        executedPrimary: execution.executedPrimary,
        executedFollowup: execution.executedFollowup,
        changed: execution.changed,
        durationMs: Date.now() - startedAt,
        retryCount: metrics.retryCount,
        errorCode: metrics.errorCode,
      });
      changed = execution.changed || changed;
    }
    if (point === "after_tool_call" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = markToolSignals(ctx) || changed;
      const failed = ctx?.success === false;
      changed = updateFailureCounters(ctx, failed) || changed;
    }
    if (point === "tool_call_error" && shouldProcessPrimaryToolHooks(ctx)) {
      changed = updateFailureCounters(ctx, true) || changed;
    }
    if (point === "after_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      if (holder?.state?.flags?.guidanceSummaryMarkPending === true) {
        holder.state.flags.guidanceSummaryMarkPending = false;
        const markedCount = await markGuidanceSummarizedMessages(ctx, meta);
        appendCapabilityLog(ctx, {
          domain: CAPABILITY_DOMAIN.GUIDANCE,
          event: GUIDANCE_EVENTS.summaryMessagesMarked,
          detail: { markedCount },
        });
        const rawSummaryText = extractRawTextContent(ctx?.ai?.content) || extractRawTextContent(ctx?.modelResponse?.content) || "";
        const summaryText = applySummaryText(ctx, rawSummaryText);
        const locale = holder.state?.locale || LOCALE.ZH_CN;
        if (isSummaryCompletionMarked(summaryText, locale)) {
          if (!shouldUseSeparateModel(meta) && !resolveCapabilityModelInvoker(meta)) {
            changed = schedulePlanUpdateByInject(ctx, summaryText) || changed;
          } else {
            changed = (await runPlanUpdateAfterSummary(ctx, meta, summaryText)) || changed;
          }
        } else {
          appendCapabilityLog(ctx, {
            domain: CAPABILITY_DOMAIN.GUIDANCE,
            event: GUIDANCE_EVENTS.summaryCompletionMarkerMissing,
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanUpdateByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
