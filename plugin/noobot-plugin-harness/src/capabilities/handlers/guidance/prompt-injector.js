/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../core/workflow-params.js";
import { resolveModelMessages } from "../../../core/message-store.js";
import { CAPABILITY_DOMAIN, LOCALE, appendCapabilityLog, ensureHarnessBucket } from "./deps.js";
import { setPendingStateWithMeta } from "../../pending-cleanup.js";
import { injectMessageWithPolicy } from "../shared/message/injection-utils.js";
import {
  buildGuidanceFailurePromptText,
  resolveScenarioPolicyFlagsFromContext,
  getGuidanceMarker,
} from "../shared/workflow/prompts.js";
import { text } from "@noobot/shared/value";

const GUIDANCE_EVENTS = WORKFLOW_PARAMS.logging.events.guidance;

export function buildGuidancePromptContent(
  locale = LOCALE.ZH_CN,
  reason = "",
  { includeMarker = false, scenario, dynamicPolicyPrompt = "", includeWorkflowPolicy = true } = {},
) {
  return buildGuidanceFailurePromptText({
    locale,
    marker: includeMarker ? getGuidanceMarker(locale) : "",
    reason,
    scenario,
    dynamicPolicyPrompt,
    includeWorkflowPolicy,
  });
}

export function maybeInjectGuidancePrompt(ctx = {}) {
  const holder = ensureHarnessBucket(ctx);
  if (!holder) return false;
  const { state } = holder;
  const locale = state?.locale || LOCALE.ZH_CN;
  const messages = resolveModelMessages(ctx);
  if (!messages) return false;
  const { scenario, dynamicPolicyPrompt } = resolveScenarioPolicyFlagsFromContext(ctx);

  if (!state.pending.guidance) return false;
  const reason = state.pending.guidance;
  injectMessageWithPolicy(ctx, {
    role: "user",
    content: buildGuidancePromptContent(locale, reason, {
      includeMarker: true,
      scenario,
      dynamicPolicyPrompt,
      includeWorkflowPolicy: false,
    }),
    injectedMessageType: `guidance_failure:${text(reason) || "unknown"}`,
    injectAt: "append",
    avoidBreakToolCallContinuity: true,
  });
  setPendingStateWithMeta(state, "guidance", null);
  state.counters.consecutiveToolFailures = 0;
  state.counters.totalToolFailures = 0;
  appendCapabilityLog(ctx, {
    domain: CAPABILITY_DOMAIN.GUIDANCE,
    event: GUIDANCE_EVENTS.guidancePromptInjected,
    detail: { reason },
  });
  return true;
}
