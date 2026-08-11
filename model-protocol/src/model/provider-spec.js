/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_PROVIDER_ID = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  DASHSCOPE: "dashscope",
  ZHIPU: "zhipu",
});

export const MODEL_ADAPTER_ID = Object.freeze({
  OPENAI_COMPATIBLE: "openai-compatible",
  DASHSCOPE: "dashscope",
});

function requireIdentity(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) throw new TypeError(`model spec.${field} is required`);
  return normalized;
}

export function normalizeProviderSpec(input = {}) {
  return Object.freeze({
    providerId: requireIdentity(input.providerId, "providerId"),
    adapterId: requireIdentity(input.adapterId, "adapterId"),
    format: requireIdentity(input.format, "format"),
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}
