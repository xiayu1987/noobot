/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
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

export function resolveModelFamilyId({ model = "" } = {}) {
  const normalized = String(model).trim().toLowerCase();
  if (/grok|xai/.test(normalized)) return MODEL_FAMILY_ID.GROK;
  if (/claude|anthropic/.test(normalized)) return MODEL_FAMILY_ID.CLAUDE;
  if (/gemini/.test(normalized)) return MODEL_FAMILY_ID.GEMINI;
  if (/qwen|qianwen/.test(normalized)) return MODEL_FAMILY_ID.QWEN;
  if (/glm|zhipu/.test(normalized)) return MODEL_FAMILY_ID.GLM;
  if (/deepseek/.test(normalized)) return MODEL_FAMILY_ID.DEEPSEEK;
  if (/kimi|moonshot/.test(normalized)) return MODEL_FAMILY_ID.KIMI;
  if (/gpt|codex|\bo[1-9]/.test(normalized)) return MODEL_FAMILY_ID.GPT;
  return MODEL_FAMILY_ID.GENERIC;
}
