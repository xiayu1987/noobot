/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { WORKFLOW_PARAMS } from "../../../../core/workflow-params.js";
import { HARNESS_I18N_KEYSET, resolveLocale, translateI18nText } from "../i18n.js";
import { LOCALE } from "../constants.js";
import { text } from "@noobot/shared/value";

const PLAN_MUTATION_EVENTS = WORKFLOW_PARAMS.logging.events.planning;

const PLAN_MUTATION_KEYS = HARNESS_I18N_KEYSET.PLAN_MUTATION;
const PLAN_MUTATION_REASON_LABEL_KEY = Object.freeze({
  empty_mutation_text: PLAN_MUTATION_KEYS.REASON_EMPTY_MUTATION_TEXT,
  invalid_mutation_type: PLAN_MUTATION_KEYS.REASON_INVALID_MUTATION_TYPE,
  empty_rendered_plan: PLAN_MUTATION_KEYS.REASON_EMPTY_RENDERED_PLAN,
  refinement_patch_not_applied: PLAN_MUTATION_KEYS.REASON_REFINEMENT_PATCH_NOT_APPLIED,
  revision_not_applied: PLAN_MUTATION_KEYS.REASON_REVISION_NOT_APPLIED,
});

function resolveMutationLocale(ctx = {}) {
  return resolveLocale(ctx);
}

function resolveReasonLabel(reason = "", locale = LOCALE.ZH_CN) {
  const key = text(reason);
  if (!key) return "";
  const labelKey = PLAN_MUTATION_REASON_LABEL_KEY[key];
  return labelKey ? translateI18nText(locale, labelKey) : key;
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
