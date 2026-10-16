/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { resolveLocale } from "../i18n.js";
import { LOCALE } from "../constants.js";
import { text } from "@noobot/shared/value";

const PLAN_MUTATION_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

const PLAN_MUTATION_REASON_LABELS = Object.freeze({
  [LOCALE.ZH_CN]: Object.freeze({
    empty_mutation_text: "\u53d8\u66f4\u6587\u672c\u4e3a\u7a7a",
    invalid_mutation_type: "\u53d8\u66f4\u7c7b\u578b\u65e0\u6548",
    empty_rendered_plan: "\u6e32\u67d3\u540e\u7684\u8ba1\u5212\u4e3a\u7a7a",
    refinement_patch_not_applied: "\u672a\u5e94\u7528\u5230\u4efb\u4f55\u7ec6\u5316\u8865\u4e01",
    revision_not_applied: "\u672a\u5e94\u7528\u5230\u4efb\u4f55\u8ba1\u5212\u4fee\u8ba2",
  }),
  [LOCALE.EN_US]: Object.freeze({
    empty_mutation_text: "Mutation text is empty",
    invalid_mutation_type: "Invalid mutation type",
    empty_rendered_plan: "Rendered plan text is empty",
    refinement_patch_not_applied: "No refinement patch was applied",
    revision_not_applied: "No revision mutation was applied",
  }),
});

function resolveMutationLocale(ctx = {}) {
  return resolveLocale(ctx);
}

function resolveReasonLabel(reason = "", locale = LOCALE.ZH_CN) {
  const key = text(reason);
  if (!key) return "";
  const dict = PLAN_MUTATION_REASON_LABELS[locale] || PLAN_MUTATION_REASON_LABELS[LOCALE.ZH_CN];
  return String(dict?.[key] || key).trim();
}

function buildBaseDetail({ stage = "", source = "", mutationResult = {} } = {}) {
  return {
    stage: text(stage),
    source: text(source),
    mutationClassification: text(mutationResult?.classification?.type),
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
} = {}) {
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationApplied,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      mode: text(mutationResult?.mode),
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
  const reason = text(mutationResult?.rejectedReason);
  appendCapabilityLog?.(ctx, {
    domain,
    event: PLAN_MUTATION_EVENTS.planMutationRejected,
    detail: {
      ...buildBaseDetail({ stage, source, mutationResult }),
      rejectedReason: reason,
      rejectedReasonLabel: resolveReasonLabel(reason, locale),
    },
  });
}
