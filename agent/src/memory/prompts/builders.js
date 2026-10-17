/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { BUILTIN_EXPERIENCE_FIELDS } from "@noobot/memory-protocol/experience/fields";
import { renderExperiencePatchProtocol } from "@noobot/memory-protocol/experience/schema";
import { text, isFunction } from "@noobot/shared/value";

function resolvePatchMeta(promptI18n = {}, stage = "", fields = BUILTIN_EXPERIENCE_FIELDS) {
  return renderExperiencePatchProtocol(stage, {
    fields,
    labels: promptI18n?.experiencePatchLabels || {},
  });
}

function buildPrompt({ promptI18n, stage, fields, builderName, payload }) {
  const builder = promptI18n?.[builderName];
  if (!isFunction(builder)) throw new Error(`memory prompt builder is missing: ${builderName}`);
  const patchMeta = resolvePatchMeta(promptI18n, stage, fields);
  return text(
    builder({
      ...payload,
      patchProtocol: patchMeta.protocol,
      patchExample: patchMeta.example,
      fieldGuide: patchMeta.fieldGuide,
    }),
  );
}

export function buildDailyExperiencePrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  knownDomainText = "",
  shortMemoryItems = [],
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "daily",
    fields,
    builderName: "dailyExperiencePrompt",
    payload: { knownDomainText, shortMemoryItems },
  });
}

export function buildWeeklySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownCategoryText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "weekly",
    fields,
    builderName: "weeklySummaryPrompt",
    payload: { domainName, knownCategoryText, mergedText },
  });
}

export function buildMonthlySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "monthly",
    fields,
    builderName: "monthlySummaryPrompt",
    payload: { domainName, knownTreeText, mergedText },
  });
}

export function buildYearlySummaryPrompt({
  promptI18n = {},
  fields = BUILTIN_EXPERIENCE_FIELDS,
  domainName = "",
  knownTreeText = "",
  mergedText = "",
} = {}) {
  return buildPrompt({
    promptI18n,
    stage: "yearly",
    fields,
    builderName: "yearlySummaryPrompt",
    payload: { domainName, knownTreeText, mergedText },
  });
}
