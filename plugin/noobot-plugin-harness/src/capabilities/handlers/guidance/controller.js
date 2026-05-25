/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  LOCALE,
  appendCapabilityLog,
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
import { runPlanUpdateAfterSummary, runGuidanceBySeparateModel } from "./model-runner.js";
import { resolveNextGuidanceAction } from "./plan-update-scheduler.js";
import { markGuidanceSummarizedMessages, markToolSignals, updateFailureCounters } from "./signal-tracker.js";
import { applySummaryText } from "./summary-manager.js";

export function createGuidanceHandler({ shouldProcessPrimaryToolHooks }) {
  return async ({ capability, point = "", ctx = {}, meta = {} } = {}) => {
    let changed = false;
    if (point === "before_llm_call") {
      const holder = ensureHarnessBucket(ctx);
      const nextAction = resolveNextGuidanceAction(holder?.state || {});
      if (shouldUseSeparateModel(meta)) {
        if (nextAction.action === "plan_update") {
          changed = maybeInjectPlanUpdatePrompt(ctx) || changed;
        }
        changed = (await runGuidanceBySeparateModel(ctx, meta)) || changed;
      } else {
        if (nextAction.action === "summary" || nextAction.action === "guidance") {
          changed = maybeInjectGuidanceOrSummaryPrompt(ctx) || changed;
        } else if (nextAction.action === "plan_update") {
          changed = maybeInjectPlanUpdatePrompt(ctx) || changed;
        }
      }
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
          event: "summary_messages_marked",
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
            event: "summary_completion_marker_missing",
          });
        }
        changed = markedCount > 0 || changed;
      }
      changed = (await maybeCapturePlanUpdateByInject(ctx)) || changed;
    }
    return { capability, point, status: "active", changed };
  };
}
