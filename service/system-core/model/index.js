/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ChatOpenAI } from "@langchain/openai";
import { fatalSystemError } from "../error/index.js";

function isProviderEnabled(provider = {}) {
  return provider?.enabled !== false;
}

function getProviders(globalConfig = {}, userConfig = {}) {
  // 用户配置优先，可覆盖全局同名 provider（支持按字段覆盖）
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
    userConfig?.defaultModel ||
    globalConfig?.defaultProvider ||
    globalConfig?.defaultModel ||
    ""
  );
}

function byAliasWithUser(alias, globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  if (!alias || !providers[alias]) return null;
  return { alias, ...providers[alias] };
}

function firstEnabledAlias(globalConfig = {}, userConfig = {}) {
  const providers = getEnabledProviders(globalConfig, userConfig);
  const keys = Object.keys(providers);
  return keys.length ? keys[0] : "";
}

function normalizeLegacySpec(input, fallback = {}) {
  if (!input) return { ...fallback };
  if (typeof input === "string") return { ...fallback, model: input };
  if (typeof input === "object") return { ...fallback, ...input };
  return { ...fallback };
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

  return normalizeLegacySpec(userConfig?.defaultModel, {
    alias: "legacy",
    format: userConfig?.llm?.provider || "openai_compatible",
    model: userConfig?.defaultModel || globalConfig?.defaultModel,
    temperature: 0,
  });
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
    return { alias, ...spec };
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

  const base = resolveDefaultModelSpec({ globalConfig, userConfig });
  return normalizeLegacySpec(skillConfig?.model, {
    ...base,
    format: skillConfig?.provider || base.format,
  });
}

export function isSameModelSpec(a, b) {
  return (
    (a?.alias || "") === (b?.alias || "") &&
    (a?.model || "") === (b?.model || "") &&
    (a?.base_url || "") === (b?.base_url || "") &&
    (a?.format || "") === (b?.format || "")
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
  const out = { ...(modelSpec.extra_body || {}) };
  if (modelSpec.reasoning_effort !== undefined)
    out.reasoning_effort = modelSpec.reasoning_effort;
  if (modelSpec.preserve_thinking !== undefined)
    out.preserve_thinking = modelSpec.preserve_thinking;
  if (modelSpec.thinking_budget !== undefined)
    out.thinking_budget = modelSpec.thinking_budget;
  return out;
}

function createChatModelFromSpec(modelSpec, options = {}) {
  if (!modelSpec?.model) {
    throw fatalSystemError("Model name is required", {
      code: "FATAL_MODEL_NAME_REQUIRED",
    });
  }
  const apiKey = resolveApiKey(modelSpec);
  if (!apiKey)
    throw fatalSystemError(
      `Missing api key for provider alias: ${modelSpec.alias || "unknown"}`,
      {
        code: "FATAL_PROVIDER_API_KEY_MISSING",
        details: { alias: modelSpec.alias || "unknown" },
      },
    );

  const modelKwargs = buildModelKwargs(modelSpec);
  const chat = new ChatOpenAI({
    model: modelSpec.model,
    temperature: Number(modelSpec.temperature ?? 0),
    streaming: Boolean(options?.streaming),
    maxTokens:
      modelSpec.max_tokens !== undefined
        ? Number(modelSpec.max_tokens)
        : modelSpec.maxTokens !== undefined
          ? Number(modelSpec.maxTokens)
          : undefined,
    apiKey,
    ...(modelSpec.base_url
      ? { configuration: { baseURL: modelSpec.base_url } }
      : {}),
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
      `enabled provider/model not found: ${String(modelName || "")}`,
      {
        code: "FATAL_MODEL_NOT_FOUND",
        details: { modelName: String(modelName || "") },
      },
    );
  }
  return createChatModelFromSpec(modelSpec, options);
}
