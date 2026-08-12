/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const MODEL_PROVIDER_ID = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE: "google",
  ALIBABA: "alibaba",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  DASHSCOPE: "dashscope",
  ZHIPU: "zhipu",
  GENERIC: "generic",
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
    // Runtime normalization derives these fields; retain legacy values here
    // for protocol-only callers that already provide a normalized spec.
    providerId: String(input.providerId || input.operatorId || "generic").trim().toLowerCase(),
    adapterId: String(
      input.adapterId ||
        (String(input.format || "").toLowerCase() === "dashscope"
          ? "dashscope"
          : "openai-compatible"),
    )
      .trim()
      .toLowerCase(),
    format: requireIdentity(input.format, "format"),
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}
