/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { PROVIDER_FORMAT, normalizeProviderFormat } from "../config/core/enums.js";

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

function resolveModelProfiles(modelSpec = {}) {
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  const aliasName = String(modelSpec?.alias || "").trim().toLowerCase();
  const mergedName = `${aliasName} ${modelName}`;
  const profiles = [];
  if (mergedName.includes("gemini")) {
    profiles.push("gemini");
    if (mergedName.includes("flash")) profiles.push("gemini_flash");
    if (mergedName.includes("pro")) profiles.push("gemini_pro");
  }
  if (mergedName.includes("gpt")) {
    profiles.push("gpt");
    if (mergedName.includes("gpt-5") || mergedName.includes("gpt5")) {
      profiles.push("gpt_5");
    }
    if (mergedName.includes("codex")) profiles.push("gpt_codex");
  }
  if (mergedName.includes("qwen") || mergedName.includes("qianwen")) {
    profiles.push("qwen");
    if (mergedName.includes("coder")) profiles.push("qwen_coder");
    if (mergedName.includes("omni")) profiles.push("qwen_omni");
    if (mergedName.includes("flash")) profiles.push("qwen_flash");
  }
  return profiles;
}

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
