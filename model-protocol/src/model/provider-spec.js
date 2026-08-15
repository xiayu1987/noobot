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

const ADAPTER_ID_BY_FORMAT = Object.freeze({
  openai_compatible: MODEL_ADAPTER_ID.OPENAI_COMPATIBLE,
  dashscope: MODEL_ADAPTER_ID.DASHSCOPE,
});

const OPERATOR_ID_BY_HOST = Object.freeze({
  "api.openai.com": MODEL_PROVIDER_ID.OPENAI,
  "api.anthropic.com": MODEL_PROVIDER_ID.ANTHROPIC,
  "generativelanguage.googleapis.com": MODEL_PROVIDER_ID.GOOGLE,
  "dashscope.aliyuncs.com": MODEL_PROVIDER_ID.ALIBABA,
  "open.bigmodel.cn": MODEL_PROVIDER_ID.ZHIPU,
  "api.deepseek.com": MODEL_PROVIDER_ID.DEEPSEEK,
});

function requireIdentity(value, field) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) throw new TypeError(`model spec.${field} is required`);
  return normalized;
}

export function normalizeProviderSpec(input = {}) {
  const format = requireIdentity(input.format, "format");
  return Object.freeze({
    operatorId: requireIdentity(input.operatorId, "operatorId"),
    adapterId: resolveModelAdapterId(format),
    format,
    baseUrl: String(input.baseUrl || input.base_url || "").trim(),
  });
}

export function resolveModelAdapterId(format = "") {
  const normalizedFormat = requireIdentity(format, "format");
  const adapterId = ADAPTER_ID_BY_FORMAT[normalizedFormat];
  if (!adapterId) throw new TypeError(`unsupported model spec.format: ${normalizedFormat}`);
  return adapterId;
}

export function resolveModelOperatorId({ format = "", baseUrl = "" } = {}) {
  const normalizedFormat = requireIdentity(format, "format");
  if (normalizedFormat === "dashscope") return MODEL_PROVIDER_ID.ALIBABA;
  resolveModelAdapterId(normalizedFormat);
  const endpoint = String(baseUrl || "").trim();
  if (!endpoint || /^\$\{[^}]+\}$/.test(endpoint)) return MODEL_PROVIDER_ID.GENERIC;
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw new TypeError("model spec.baseUrl must be an absolute URL or a configuration placeholder");
  }
  return OPERATOR_ID_BY_HOST[host] || MODEL_PROVIDER_ID.GENERIC;
}
