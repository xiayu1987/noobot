/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * Model provider resolution & ChatOpenAI creation.
 * Multimodal attachment logic is delegated to ./attachment-formatter.js
 */
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { fatalSystemError } from "../error/index.js";
import { tSystem } from "../i18n/system-text.js";
import { normalizeProviderFormat, PROVIDER_FORMAT } from "../config/core/enums.js";
import {
  buildAttachmentContentBlock,
  normalizeModelOutputContent,
} from "./attachment-formatter.js";
import { getModelDefaultFields } from "./default-params.js";

function isProviderEnabled(provider = {}) {
  return provider?.enabled !== false;
}

function getProviders(globalConfig = {}, userConfig = {}) {
  const globalProviders = globalConfig?.providers || {};
  const userProviders = userConfig?.providers || {};
  const merged = { ...globalProviders };
  for (const [alias, userProvider] of Object.entries(userProviders)) {
    merged[alias] = {
      ...(globalProviders[alias] || {}),
      ...(userProvider || {}),
    };
  }
  return merged;
}

function getEnabledProviders(globalConfig = {}, userConfig = {}) {
  const providers = getProviders(globalConfig, userConfig);
  return Object.fromEntries(
    Object.entries(providers).filter(([, provider]) =>
      isProviderEnabled(provider),
    ),
  );
}

function pickAlias({ globalConfig, userConfig, skillConfig }) {
  return (
    skillConfig?.provider ||
    skillConfig?.model ||
    userConfig?.defaultProvider ||
    globalConfig?.defaultProvider ||
    ""
  );
}

function byAliasWithUser(alias, globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  if (!alias || !providers[alias]) return null;
  return normalizeModelSpecWithDefaults({ alias, ...providers[alias] });
}

function firstEnabledAlias(globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  const keys = Object.keys(providers);
  return keys.length ? keys[0] : "";
}

function normalizeModelSpecInput(input, fallback = {}) {
  if (!input) return { ...fallback };
  if (typeof input === "string") return { ...fallback, model: input };
  if (typeof input === "object") return { ...fallback, ...input };
  return { ...fallback };
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function hasOwnValue(spec = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(spec || {}, key);
}

function normalizeModelSpecWithDefaults(modelSpec = {}) {
  const normalized = { ...(modelSpec || {}) };
  const defaultsByFormat = getModelDefaultFields(normalized);
  for (const [fieldKey, defaultValue] of Object.entries(defaultsByFormat)) {
    if (hasOwnValue(normalized, fieldKey)) {
      normalized[fieldKey] = toFiniteNumber(normalized[fieldKey], defaultValue);
      continue;
    }
    normalized[fieldKey] = defaultValue;
  }
  return normalized;
}

export function resolveDefaultModelSpec({ globalConfig, userConfig }) {
  const alias = pickAlias({ globalConfig, userConfig });
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;
  const fallbackAlias = firstEnabledAlias(globalConfig, userConfig);
  const fromFallbackAlias = byAliasWithUser(
    fallbackAlias,
    globalConfig,
    userConfig,
  );
  if (fromFallbackAlias) return fromFallbackAlias;
  return null;
}

export function resolveModelSpecByAlias({
  alias,
  globalConfig,
  userConfig,
  fallbackToDefault = true,
}) {
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;
  if (!fallbackToDefault) return null;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

export function resolveModelSpecByName({
  modelName,
  globalConfig,
  userConfig,
  fallbackToDefault = true,
}) {
  const input = String(modelName || "").trim();
  if (!input) {
    if (!fallbackToDefault) return null;
    return resolveDefaultModelSpec({ globalConfig, userConfig });
  }
  const byAlias = resolveModelSpecByAlias({
    alias: input,
    globalConfig,
    userConfig,
    fallbackToDefault: false,
  });
  if (byAlias) return byAlias;
  const providers = getEnabledProviders(globalConfig, userConfig);
  const byModel = Object.entries(providers).find(
    ([, cfg]) => String(cfg?.model || "") === input,
  );
  if (byModel) {
    const [alias, spec] = byModel;
    return normalizeModelSpecWithDefaults({ alias, ...spec });
  }
  if (!fallbackToDefault) return null;
  return resolveDefaultModelSpec({ globalConfig, userConfig });
}

export function resolveSkillModelSpec({
  skillConfig,
  globalConfig,
  userConfig,
}) {
  if (!skillConfig)
    return resolveDefaultModelSpec({ globalConfig, userConfig });

  const alias = pickAlias({ globalConfig, userConfig, skillConfig });
  const fromAlias = byAliasWithUser(alias, globalConfig, userConfig);
  if (fromAlias) return fromAlias;

  const base = resolveDefaultModelSpec({ globalConfig, userConfig }) || {};
  return normalizeModelSpecWithDefaults(
    normalizeModelSpecInput(skillConfig?.model, {
      ...base,
      format: skillConfig?.provider || base.format,
    }),
  );
}

export function isSameModelSpec(leftModelSpec, rightModelSpec) {
  return (
    (leftModelSpec?.alias || "") === (rightModelSpec?.alias || "") &&
    (leftModelSpec?.model || "") === (rightModelSpec?.model || "") &&
    (leftModelSpec?.base_url || "") === (rightModelSpec?.base_url || "") &&
    (leftModelSpec?.format || "") === (rightModelSpec?.format || "")
  );
}

function resolveApiKey(modelSpec = {}) {
  if (modelSpec.api_key) return modelSpec.api_key;
  if (modelSpec.format === "dashscope") {
    return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || "";
  }
  if ((modelSpec.base_url || "").includes("poe.com")) {
    return process.env.POE_API_KEY || process.env.OPENAI_API_KEY || "";
  }
  return process.env.OPENAI_API_KEY || "";
}

function buildModelKwargs(modelSpec = {}) {
  const normalizedSpec = normalizeModelSpecWithDefaults(modelSpec);
  const out = { ...(normalizedSpec.extra_body || {}) };
  const providerFormat = normalizeProviderFormat(normalizedSpec?.format || "");
  if (normalizedSpec.reasoning_effort !== undefined)
    out.reasoning_effort = normalizedSpec.reasoning_effort;
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE &&
    normalizedSpec.preserve_thinking !== undefined
  ) {
    out.preserve_thinking = normalizedSpec.preserve_thinking;
  }
  if (normalizedSpec.top_p !== undefined) out.top_p = normalizedSpec.top_p;
  if (normalizedSpec.frequency_penalty !== undefined)
    out.frequency_penalty = normalizedSpec.frequency_penalty;
  if (normalizedSpec.presence_penalty !== undefined)
    out.presence_penalty = normalizedSpec.presence_penalty;
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE &&
    normalizedSpec.thinking_budget !== undefined
  )
    out.thinking_budget = normalizedSpec.thinking_budget;
  return out;
}

function resolveUseResponsesApi(modelSpec = {}) {
  if (typeof modelSpec?.useResponsesApi === "boolean") {
    return modelSpec.useResponsesApi;
  }
  if (typeof modelSpec?.use_responses_api === "boolean") {
    return modelSpec.use_responses_api;
  }
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  if (providerFormat !== "openai_compatible") return false;
  return modelName.includes("codex") || modelName.includes("gpt-5.3-codex");
}

function createChatModelFromSpec(modelSpec, options = {}) {
  const normalizedSpec = normalizeModelSpecWithDefaults(modelSpec);
  if (!normalizedSpec?.model) {
    throw fatalSystemError(tSystem("model.nameRequired"), {
      code: "FATAL_MODEL_NAME_REQUIRED",
    });
  }
  const apiKey = resolveApiKey(normalizedSpec);
  if (!apiKey)
    throw fatalSystemError(
      `${tSystem("model.apiKeyMissingForProviderAlias")}: ${normalizedSpec.alias || "unknown"}`,
      {
        code: "FATAL_PROVIDER_API_KEY_MISSING",
        details: { alias: normalizedSpec.alias || "unknown" },
      },
    );

  const modelKwargs = buildModelKwargs(normalizedSpec);
  const defaultsByFormat = getModelDefaultFields(normalizedSpec);
  const chat = new ChatOpenAI({
    model: normalizedSpec.model,
    temperature: Number(normalizedSpec.temperature ?? defaultsByFormat.temperature ?? 0.7),
    streaming: Boolean(options?.streaming),
    maxTokens:
      normalizedSpec.max_tokens !== undefined ? Number(normalizedSpec.max_tokens) : undefined,
    apiKey,
    ...(normalizedSpec.base_url
      ? { configuration: { baseURL: normalizedSpec.base_url } }
      : {}),
    useResponsesApi: resolveUseResponsesApi(normalizedSpec),
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
  });

  return chat;
}

export function createChatModel(options = {}) {
  const globalConfig = options?.globalConfig || {};
  const userConfig = options?.userConfig || {};
  const modelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
  return createChatModelFromSpec(modelSpec, options);
}

export function createChatModelByName(modelName, options = {}) {
  const globalConfig = options?.globalConfig || {};
  const userConfig = options?.userConfig || {};
  const modelSpec = resolveModelSpecByName({
    modelName,
    globalConfig,
    userConfig,
    fallbackToDefault: false,
  });
  if (!modelSpec) {
    throw fatalSystemError(
      `${tSystem("model.enabledProviderModelNotFound")}: ${String(modelName || "")}`,
      {
        code: "FATAL_MODEL_NOT_FOUND",
        details: { modelName: String(modelName || "") },
      },
    );
  }
  return createChatModelFromSpec(modelSpec, options);
}

// Re-export attachment utilities for external consumers
export { buildAttachmentContentBlock, normalizeModelOutputContent };

export async function invokeModelWithTextAndAttachments({
  modelName = "",
  text = "",
  attachments = [],
  globalConfig = {},
  userConfig = {},
  streaming = false,
}) {
  const resolvedModelSpec = resolveModelSpecByName({
    modelName,
    globalConfig,
    userConfig,
    fallbackToDefault: false,
  });
  if (!resolvedModelSpec) {
    throw fatalSystemError(
      `${tSystem("model.enabledProviderModelNotFound")}: ${String(modelName || "")}`,
      {
        code: "FATAL_MODEL_NOT_FOUND",
        details: { modelName: String(modelName || "") },
      },
    );
  }
  const providerFormat = normalizeProviderFormat(resolvedModelSpec);
  const modelInstance = createChatModelFromSpec(resolvedModelSpec, { streaming });
  const userText = String(text || "").trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const attachmentBlocks = normalizedAttachments
    .map((attachmentItem) =>
      buildAttachmentContentBlock(attachmentItem, providerFormat),
    )
    .filter(Boolean);
  const messageContent = attachmentBlocks.length
    ? [{ type: "text", text: userText }, ...attachmentBlocks]
    : userText;
  const modelResponse = await modelInstance.invoke([
    new HumanMessage({ content: messageContent }),
  ]);
  return {
    response: modelResponse,
    text: normalizeModelOutputContent(modelResponse?.content),
    modelSpec: normalizeModelSpecWithDefaults(resolvedModelSpec),
  };
}
