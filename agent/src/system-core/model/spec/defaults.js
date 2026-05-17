/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Model default parameter profiles by provider format.
 */
import { PROVIDER_FORMAT, normalizeProviderFormat } from "../../config/core/enums.js";

export const MODEL_DEFAULT_FIELDS_BY_FORMAT = Object.freeze({
  [PROVIDER_FORMAT.OPENAI_COMPATIBLE]: Object.freeze({
    default: Object.freeze({
      temperature: 0.65,
      top_p: 1,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
    gemini: Object.freeze({
      temperature: 0.7,
      top_p: 0.95,
      frequency_penalty: 0.05,
      presence_penalty: 0.05,
    }),
    gpt: Object.freeze({
      temperature: 0.6,
      top_p: 1,
    }),
    gpt_codex: Object.freeze({
      temperature: 0.45,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    }),
    gpt_5: Object.freeze({
      temperature: 0.55,
      top_p: 1,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
    gemini_flash: Object.freeze({
      temperature: 0.75,
      top_p: 0.95,
      frequency_penalty: 0.05,
      presence_penalty: 0.05,
    }),
    gemini_pro: Object.freeze({
      temperature: 0.6,
      top_p: 0.9,
      frequency_penalty: 0.1,
      presence_penalty: 0.1,
    }),
  }),
  [PROVIDER_FORMAT.DASHSCOPE]: Object.freeze({
    default: Object.freeze({
      temperature: 0.7,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
    qwen: Object.freeze({
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
    qwen_coder: Object.freeze({
      temperature: 0.55,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.1,
      thinking_budget: 0,
    }),
    qwen_omni: Object.freeze({
      temperature: 0.6,
      top_p: 0.9,
      frequency_penalty: 0.2,
      presence_penalty: 0.15,
      thinking_budget: 0,
    }),
    qwen_flash: Object.freeze({
      temperature: 0.75,
      top_p: 0.9,
      frequency_penalty: 0.25,
      presence_penalty: 0.2,
      thinking_budget: 0,
    }),
  }),
});

/**
 * Rule-table for model profile resolution (replaces sequential includes).
 * Order matters: more specific rules first.
 */
const PROFILE_RULES = [
  { match: /gemini.*flash/, profile: "gemini_flash" },
  { match: /gemini.*pro/, profile: "gemini_pro" },
  { match: /gemini/, profile: "gemini" },
  { match: /gpt-5|gpt5/, profile: "gpt_5" },
  { match: /codex/, profile: "gpt_codex" },
  { match: /gpt/, profile: "gpt" },
  { match: /qianwen/, profile: "qwen" },
  { match: /qwen.*coder/, profile: "qwen_coder" },
  { match: /qwen.*omni/, profile: "qwen_omni" },
  { match: /qwen.*flash/, profile: "qwen_flash" },
  { match: /qwen/, profile: "qwen" },
];

/**
 * Resolve model profiles from spec using rule-table matching.
 * @param {object} modelSpec
 * @returns {string[]}
 */
function resolveModelProfiles(modelSpec = {}) {
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  const aliasName = String(modelSpec?.alias || "").trim().toLowerCase();
  const mergedName = `${aliasName} ${modelName}`;

  const profiles = [];
  for (const { match, profile } of PROFILE_RULES) {
    if (match.test(mergedName)) {
      profiles.push(profile);
    }
  }
  return profiles;
}

/**
 * Get merged default fields for a model spec based on format and profiles.
 * @param {object} modelSpec
 * @returns {object}
 */
export function getModelDefaultFields(modelSpec = {}) {
  const format = modelSpec?.format || "";
  const normalizedFormat = normalizeProviderFormat(format);
  const formatDefaults =
    MODEL_DEFAULT_FIELDS_BY_FORMAT[normalizedFormat] ||
    MODEL_DEFAULT_FIELDS_BY_FORMAT[PROVIDER_FORMAT.OPENAI_COMPATIBLE];
  const profiles = resolveModelProfiles(modelSpec);
  const mergedDefaults = { ...(formatDefaults?.default || {}) };
  for (const profile of profiles) {
    Object.assign(mergedDefaults, formatDefaults?.[profile] || {});
  }
  return mergedDefaults;
}
