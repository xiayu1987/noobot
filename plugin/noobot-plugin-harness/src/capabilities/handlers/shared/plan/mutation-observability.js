/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { resolveLocale } from "../i18n.js";
import { LOCALE } from "../constants.js";

const PLAN_MUTATION_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

const PLAN_MUTATION_REASON_LABELS = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    empty_mutation_text: "\u53d8\u66f4\u6587\u672c\u4e3a\u7a7a",
    invalid_mutation_type: "\u53d8\u66f4\u7c7b\u578b\u65e0\u6548",
    empty_rendered_plan: "\u6e32\u67d3\u540e\u7684\u8ba1\u5212\u4e3a\u7a7a",
    refinement_patch_not_applied: "\u672a\u5e94\u7528\u5230\u4efb\u4f55\u7ec6\u5316\u8865\u4e01",
    invariant_blocked: "\u8ba1\u5212\u4e0d\u53d8\u91cf\u6821\u9a8c\u672a\u901a\u8fc7",
    synthetic_main_placeholder_collapse:
      "\u8ba1\u5212\u6536\u655b\u5230\u5360\u4f4d\u4e3b\u8ba1\u5212\uff0c\u88ab\u7b56\u7565\u62e6\u622a",
    revision_not_applied: "\u672a\u5e94\u7528\u5230\u4efb\u4f55\u8ba1\u5212\u4fee\u8ba2",
    revision_contains_sub_plan_patch:
      "\u4fee\u8ba2\u9636\u6bb5\u5305\u542b\u5b50\u8ba1\u5212 patch\uff0c\u5df2\u81ea\u52a8\u77eb\u6b63\u4e3a\u7ec6\u5316\u6d41\u7a0b",
  }),
  [LOCALE.EN_US]: Object.freeze({
    empty_mutation_text: "Mutation text is empty",
    invalid_mutation_type: "Invalid mutation type",
    empty_rendered_plan: "Rendered plan text is empty",
    refinement_patch_not_applied: "No refinement patch was applied",
    invariant_blocked: "Plan invariant validation blocked this mutation",
    synthetic_main_placeholder_collapse:
      "Mutation collapsed plan to a synthetic placeholder and was blocked by policy",
    revision_not_applied: "No revision mutation was applied",
    revision_contains_sub_plan_patch:
      "Revision payload includes sub-plan patch and is auto-coerced to refinement flow",
  }),
});

function resolveMutationLocale(ctx = {}) {
  return resolveLocale(ctx);
}

function resolveReasonLabel(reason = "", locale = LOCALE.ZH_CN) {
  const key = String(reason || "").trim();
  if (!key) return "";
  const dict = PLAN_MUTATION_REASON_LABELS[locale] || PLAN_MUTATION_REASON_LABELS[LOCALE.ZH_CN];
  return String(dict?.[key] || key).trim();
}

function buildBaseDetail({ stage = "", source = "", mutationResult = {} } = {}) {
  return {
    stage: String(stage || "").trim(),
    source: String(source || "").trim(),
    mutationClassification: String(mutationResult?.classification?.type || "").trim(),
  };
}

export function emitPlanMutationParsed({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationParsed,
    detail: buildBaseDetail({ stage, source, mutationResult }),
  });
}

export function emitPlanMutationApplied({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
  mode = "",
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationApplied,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      mode: String(mode || mutationResult?.mode || "").trim(),
    },
  });
}

export function emitPlanMutationRejected({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  mutationResult = {},
} = {}) {
  const locale = resolveMutationLocale(ctx);
  const reason = String(mutationResult?.rejectedReason || "").trim();
  appendCapabilityLog?.(ctx, {
    domain,
    event: reason.includes("invariant")
      ? PLAN_MUTATION_EVENTS.planMutationInvariantBlocked
      : PLAN_MUTATION_EVENTS.planMutationRejected,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      rejectedReason: reason,
      rejectedReasonLabel: resolveReasonLabel(reason, locale),
    },
  });
}

export function emitPlanMutationStageMismatchAutocoerced({
  appendCapabilityLog,
  ctx = {},
  domain,
  stage = "",
  source = "",
  reason = "revision_contains_sub_plan_patch",
} = {}) {
  const locale = resolveMutationLocale(ctx);
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationStageMismatchAutocoerced,
    detail: {
      stage: String(stage || "").trim(),
      source: String(source || "").trim(),
      reason: String(reason || "").trim(),
      reasonLabel: resolveReasonLabel(reason, locale),
    },
  });
}
