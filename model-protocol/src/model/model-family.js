/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * The model families this protocol recognises. A family is the sampling and
 * cache-protocol dialect a model speaks; it is not the operator that hosts it.
 * This enum is the only place a family identity is declared.
 */
export const MODEL_FAMILY_ID = Object.freeze({
  GPT: "gpt",
  CLAUDE: "claude",
  GEMINI: "gemini",
  GROK: "grok",
  QWEN: "qwen",
  GLM: "glm",
  DEEPSEEK: "deepseek",
  KIMI: "kimi",
  GENERIC: "generic",
});

const MODEL_FAMILY_IDS = new Set(Object.values(MODEL_FAMILY_ID));

export function requireModelFamilyId(value, field = "model spec.modelFamily") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) throw new TypeError(`${field} is required`);
  if (!MODEL_FAMILY_IDS.has(normalized)) {
    throw new TypeError(`unsupported ${field}: ${normalized}`);
  }
  return normalized;
}
