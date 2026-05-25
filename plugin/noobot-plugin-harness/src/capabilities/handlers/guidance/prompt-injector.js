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
} from "./deps.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { injectMessageWithPolicy } from "../shared/message-injection-utils.js";
import { buildPlanChecklistSystemContent } from "../shared/plan-checklist-context.js";
import {
  buildGuidanceFailurePromptText,
  buildGuidanceSummaryPromptText,
  getGuidanceMarker,
  getGuidanceSummaryMarker,
} from "../shared/workflow-prompts.js";

export function buildGuidancePromptContent(locale = LOCALE.ZH_CN, reason = "", { includeMarker = false } = {}) {
  return buildGuidanceFailurePromptText({
    locale,
    marker: includeMarker ? getGuidanceMarker(locale) : "",
    reason,
  });
}

export function maybeInjectGuidanceOrSummaryPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { bucket, state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;

  if (state.pending.summary === true) {
    const checklistContent = buildPlanChecklistSystemContent({
      locale,
      planText: bucket?.planText || "",
      bucket,
    });
    if (checklistContent) {
      injectMessageWithPolicy(ctx, {
        role: "system",
        content: checklistContent,
        injectAt: "append",
        dedupe: false,
        avoidBreakToolCallContinuity: true,
      });
    }
    const userInjection = injectMessageWithPolicy(ctx, {
      role: "user",
      content: buildGuidanceSummaryPromptText({
        locale,
        marker: getGuidanceSummaryMarker(locale),
      }),
      injectAt: "append",
      dedupe: false,
      avoidBreakToolCallContinuity: true,
    });
    if (!userInjection.injected) return false;
    setPendingStateWithMeta(state, "summary", false);
    state.counters.llmTurns = 0;
    state.flags.guidanceSummaryMarkPending = true;
    appendCapabilityLog(ctx, {
      domain: CAPABILITY_DOMAIN.GUIDANCE,
      event: "summary_prompt_injected",
    });
    return true;
  }

  if (!state.pending.guidance) return false;
  const reason = state.pending.guidance;
  injectMessageWithPolicy(ctx, {
    role: "system",
    content: buildGuidancePromptContent(locale, reason, { includeMarker: true }),
    injectAt: "prepend",
    avoidBreakToolCallContinuity: true,
  });
  setPendingStateWithMeta(state, "guidance", null);
  state.counters.consecutiveToolFailures = 0;
  state.counters.totalToolFailures = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: "guidance_prompt_injected",
    detail: { reason },
  });
  return true;
}
