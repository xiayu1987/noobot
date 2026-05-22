/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  CAPABILITY_DOMAIN,
  GUIDANCE_WEB_SERVICE_NAME,
  GUIDANCE_WEB_TOOL_NAMES,
  LOCALE,
  TOOL_NAME_SET,
  appendCapabilityLog,
  ensureHarnessBucket,
  translateI18nText,
} from "./deps.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";

export function buildGuidancePromptContent(locale = LOCALE.ZH_CN, reason = "", { includeMarker = false } = {}) {
  const lines = [
    translateI18nText(locale, "guidanceBody", { reason }),
    translateI18nText(locale, "guidancePreferTools", { tools: GUIDANCE_WEB_TOOL_NAMES.join(", ") }),
    translateI18nText(locale, "guidanceWebService", {
      service: GUIDANCE_WEB_SERVICE_NAME,
      tool: TOOL_NAME_SET.CALL_SERVICE,
    }),
  ];
  if (includeMarker) {
    lines.unshift(translateI18nText(locale, "guidanceMarker"));
  }
  return lines.join("\n");
}

export function maybeInjectGuidanceOrSummaryPrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const messages = Array.isArray(ctx?.messages) ? ctx.messages : null;
  if (!messages) return false;

  if (state.pending.summary === true) {
    messages.unshift({
      role: "system",
      content: [
        translateI18nText(locale, "guidanceSummaryMarker"),
        translateI18nText(locale, "guidanceSummaryBody"),
      ].join("\n"),
    });
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
  messages.unshift({
    role: "system",
    content: buildGuidancePromptContent(locale, reason, { includeMarker: true }),
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
