/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 *
 * ChatOpenAI factory: API key resolution, kwargs building, model creation.
 */
import { ChatOpenAI } from "@langchain/openai";
import { fatalSystemError } from "../../error/index.js";
import { tSystem } from "noobot-i18n/agent/system-text";
import { normalizeProviderFormat, PROVIDER_FORMAT } from "../../config/core/enums.js";
import { normalizeModelSpecWithDefaults } from "../spec/normalizer.js";
import { getModelDefaultFields } from "../spec/defaults.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../resolver/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import {
  buildPluginModelHeaders,
  MODEL_NAME_HEADER_KEY,
  PARENT_SESSION_HEADER_KEY,
} from "../headers/plugin-headers.js";

const DEFAULT_MAIN_FLOW = "agent.main";
const DEFAULT_MAIN_PURPOSE = "main_agent";
const DEFAULT_MAIN_DOMAIN = "primary";
const DEFAULT_PROMPT_CACHE_RETENTION = "24h";
const DEFAULT_PROMPT_CACHE_KEY_PREFIX = "noobot-main";
const DASHSCOPE_SESSION_CACHE_HEADER_KEY = "x-dashscope-session-cache";
const CACHE_VENDOR = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GEMINI: "gemini",
  DEEPSEEK: "deepseek",
  DASHSCOPE: "dashscope",
  UNKNOWN: "unknown",
});
const OPENAI_EXTENDED_PROMPT_CACHE_MODELS = [
  /^gpt-4\.1(?:\b|[-_.])/,
  /^gpt-5(?:\b|[-_.])/,
];

function parseOpenAiGptMajor(modelName = "") {
  const normalized = String(modelName || "").trim().toLowerCase();
  const match = normalized.match(/\bgpt[-_]?(\d+)(?:\b|[-_.])/);
  if (!match) return null;
  const major = Number(match[1]);
  return Number.isInteger(major) ? major : null;
}

function resolveCacheVendor(modelSpec = {}) {
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  const source = [
    modelSpec?.provider,
    modelSpec?.provider_name,
    modelSpec?.providerName,
    modelSpec?.alias,
    modelSpec?.model,
    modelSpec?.base_url,
    modelSpec?.baseURL,
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE ||
    /dashscope|aliyuncs|qwen|qianwen/.test(source)
  ) {
    return CACHE_VENDOR.DASHSCOPE;
  }
  if (/deepseek/.test(source)) return CACHE_VENDOR.DEEPSEEK;
  if (/gemini|generativelanguage\.googleapis|googleapis/.test(source)) return CACHE_VENDOR.GEMINI;
  if (/anthropic|claude/.test(source)) return CACHE_VENDOR.ANTHROPIC;
  if (
    /\b(gpt|o\d|codex|chatgpt)[-_\w.]*/.test(source) ||
    /api\.openai\.com|openai/.test(source)
  ) {
    return CACHE_VENDOR.OPENAI;
  }
  return CACHE_VENDOR.UNKNOWN;
}

function isOpenAiPromptCacheCompatibleModel(modelSpec = {}) {
  return resolveCacheVendor(modelSpec) === CACHE_VENDOR.OPENAI;
}

function supportsOpenAiExtendedPromptCache(modelSpec = {}) {
  if (!isOpenAiPromptCacheCompatibleModel(modelSpec)) return false;
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  const major = parseOpenAiGptMajor(modelName);
  if (Number.isInteger(major) && major > 5) return true;
  return OPENAI_EXTENDED_PROMPT_CACHE_MODELS.some((pattern) => pattern.test(modelName));
}

function supportsTopP(modelSpec = {}) {
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  if (providerFormat === PROVIDER_FORMAT.OPENAI_COMPATIBLE && modelName.includes("gpt-5")) {
    return false;
  }
  return true;
}

function normalizePromptCacheKey(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).trim();
  if (!normalized) return "";
  return normalized.slice(0, 200);
}

function buildDefaultPromptCacheKey(modelSpec = {}) {
  if (!isOpenAiPromptCacheCompatibleModel(modelSpec)) return "";
  const modelSegment = String(modelSpec?.model || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!modelSegment) return "";
  return normalizePromptCacheKey(`${DEFAULT_PROMPT_CACHE_KEY_PREFIX}-${modelSegment}`);
}

function resolvePromptCacheSettings(modelSpec = {}) {
  const normalizedSpec = normalizeModelSpecWithDefaults(modelSpec);
  if (!isOpenAiPromptCacheCompatibleModel(normalizedSpec)) {
    return {
      promptCacheKey: "",
      promptCacheRetention: "",
    };
  }
  const out = normalizedSpec.extra_body && typeof normalizedSpec.extra_body === "object"
    ? { ...normalizedSpec.extra_body }
    : {};
  let promptCacheKey = normalizePromptCacheKey(
    normalizedSpec.prompt_cache_key ?? normalizedSpec.promptCacheKey,
  );
  if (!promptCacheKey && "prompt_cache_key" in out) {
    promptCacheKey = normalizePromptCacheKey(out.prompt_cache_key);
  }
  if (!promptCacheKey) {
    promptCacheKey = buildDefaultPromptCacheKey(normalizedSpec);
  }
  const promptCacheRetention = String(
      normalizedSpec.prompt_cache_retention ??
      normalizedSpec.promptCacheRetention ??
      out.prompt_cache_retention ??
      (supportsOpenAiExtendedPromptCache(normalizedSpec) ? DEFAULT_PROMPT_CACHE_RETENTION : "") ??
      "",
  ).trim();
  return {
    promptCacheKey,
    promptCacheRetention,
  };
}

/**
 * Resolve API key for a model spec from env or explicit config.
 * @param {object} modelSpec
 * @returns {string}
 */
export function resolveApiKey(modelSpec = {}) {
  if (modelSpec.api_key) return modelSpec.api_key;
  if (modelSpec.format === "dashscope") {
    return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || "";
  }
  if ((modelSpec.base_url || "").includes("poe.com")) {
    return process.env.POE_API_KEY || process.env.OPENAI_API_KEY || "";
  }
  return process.env.OPENAI_API_KEY || "";
}

/**
 * Build modelKwargs object from normalized spec.
 * @param {object} modelSpec
 * @returns {object}
 */
export function buildModelKwargs(modelSpec = {}) {
  const normalizedSpec = normalizeModelSpecWithDefaults(modelSpec);
  const out = { ...(normalizedSpec.extra_body || {}) };
  const providerFormat = normalizeProviderFormat(normalizedSpec?.format || "");
  const cacheVendor = resolveCacheVendor(normalizedSpec);
  const { promptCacheKey, promptCacheRetention } = resolvePromptCacheSettings(normalizedSpec);
  if (cacheVendor === CACHE_VENDOR.OPENAI && promptCacheKey) {
    out.prompt_cache_key = promptCacheKey;
  } else if ("prompt_cache_key" in out) {
    delete out.prompt_cache_key;
  }
  if (cacheVendor === CACHE_VENDOR.OPENAI && promptCacheRetention) {
    out.prompt_cache_retention = promptCacheRetention;
  } else if ("prompt_cache_retention" in out) {
    delete out.prompt_cache_retention;
  }
  if (normalizedSpec.reasoning_effort !== undefined)
    out.reasoning_effort = normalizedSpec.reasoning_effort;
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE &&
    normalizedSpec.enable_thinking !== undefined
  ) {
    out.enable_thinking = normalizedSpec.enable_thinking === true;
  }
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE &&
    normalizedSpec.preserve_thinking !== undefined
  ) {
    out.preserve_thinking = normalizedSpec.preserve_thinking;
  }
  if (normalizedSpec.top_p !== undefined && supportsTopP(normalizedSpec)) {
    out.top_p = normalizedSpec.top_p;
  } else if (!supportsTopP(normalizedSpec) && "top_p" in out) {
    delete out.top_p;
  }
  if (normalizedSpec.frequency_penalty !== undefined)
    out.frequency_penalty = normalizedSpec.frequency_penalty;
  if (normalizedSpec.presence_penalty !== undefined)
    out.presence_penalty = normalizedSpec.presence_penalty;
  if (
    providerFormat === PROVIDER_FORMAT.DASHSCOPE &&
    normalizedSpec.thinking_budget !== undefined
  ) {
    const thinkingBudget = Math.floor(Number(normalizedSpec.thinking_budget));
    if (Number.isFinite(thinkingBudget) && thinkingBudget >= 0) {
      out.thinking_budget = thinkingBudget;
    }
  }
  return out;
}

/**
 * Determine whether to use the OpenAI Responses API.
 * @param {object} modelSpec
 * @returns {boolean}
 */
export function resolveUseResponsesApi(modelSpec = {}) {
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

function normalizeAdditionalHeaders(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key, value]) => key && value),
  );
}

function resolveContextObject(options = {}) {
  const ctx = options?.context;
  return ctx && typeof ctx === "object" && !Array.isArray(ctx) ? ctx : {};
}

function resolveHeaderSessionId(options = {}) {
  const context = resolveContextObject(options);
  const contextRuntime =
    context?.runtime && typeof context.runtime === "object" ? context.runtime : {};
  const contextAgentContext =
    context?.agentContext && typeof context.agentContext === "object"
      ? context.agentContext
      : {};
  const value = String(
    context?.sessionId ||
      options?.sessionId ||
      contextRuntime?.systemRuntime?.sessionId ||
      options?.runtime?.systemRuntime?.sessionId ||
      contextRuntime?.sessionId ||
      options?.runtime?.sessionId ||
      contextAgentContext?.sessionId ||
      options?.agentContext?.sessionId ||
      contextAgentContext?.session?.current?.sessionId ||
      options?.agentContext?.session?.current?.sessionId ||
      contextAgentContext?.session?.id ||
      options?.agentContext?.session?.id ||
      "",
  ).trim();
  return value.slice(0, 200);
}

function resolveHeaderParentSessionId(options = {}) {
  return resolveParentSessionId(options);
}

function buildChatModelConfiguration(normalizedSpec = {}, options = {}) {
  const sessionId = resolveHeaderSessionId(options);
  const parentSessionId = resolveHeaderParentSessionId(options);
  const providerFormat = normalizeProviderFormat(normalizedSpec?.format || "");
  const useResponsesApi = resolveUseResponsesApi(normalizedSpec);
  const defaultHeaders = {
    [MODEL_NAME_HEADER_KEY]: String(normalizedSpec?.model || "").trim(),
    ...buildPluginModelHeaders({
      flow: DEFAULT_MAIN_FLOW,
      purpose: DEFAULT_MAIN_PURPOSE,
      domain: DEFAULT_MAIN_DOMAIN,
      sessionId,
    }),
    ...(parentSessionId ? { [PARENT_SESSION_HEADER_KEY]: parentSessionId } : {}),
    ...(providerFormat === PROVIDER_FORMAT.DASHSCOPE && useResponsesApi
      ? { [DASHSCOPE_SESSION_CACHE_HEADER_KEY]: "enable" }
      : {}),
    ...normalizeAdditionalHeaders(options?.additionalHeaders),
  };
  const config = {
    defaultHeaders,
  };

  if (normalizedSpec.base_url) {
    config.baseURL = normalizedSpec.base_url;
  }

  return config;
}

/**
 * Create a ChatOpenAI instance from a model spec.
 * @param {object} modelSpec
 * @param {object} options
 * @returns {ChatOpenAI}
 */
export function createChatModelFromSpec(modelSpec, options = {}) {
  const normalizedSpec = normalizeModelSpecWithDefaults(modelSpec);
  if (!normalizedSpec?.model) {
    throw fatalSystemError(tSystem("model.nameRequired"), {
      code: ERROR_CODE.FATAL_MODEL_NAME_REQUIRED,
    });
  }
  const apiKey = resolveApiKey(normalizedSpec);
  if (!apiKey)
    throw fatalSystemError(
      `${tSystem("model.apiKeyMissingForProviderAlias")}: ${normalizedSpec.alias || "unknown"}`,
      {
        code: ERROR_CODE.FATAL_PROVIDER_API_KEY_MISSING,
        details: { alias: normalizedSpec.alias || "unknown" },
      },
    );

  const modelKwargs = buildModelKwargs(normalizedSpec);
  const { promptCacheKey, promptCacheRetention } = resolvePromptCacheSettings(normalizedSpec);
  const defaultsByFormat = getModelDefaultFields(normalizedSpec);
  const chat = new ChatOpenAI({
    model: normalizedSpec.model,
    temperature: Number(normalizedSpec.temperature ?? defaultsByFormat.temperature ?? 0.7),
    streaming: Boolean(options?.streaming),
    maxTokens:
      normalizedSpec.max_tokens !== undefined ? Number(normalizedSpec.max_tokens) : undefined,
    apiKey,
    configuration: buildChatModelConfiguration(normalizedSpec, options),
    useResponsesApi: resolveUseResponsesApi(normalizedSpec),
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(promptCacheRetention ? { promptCacheRetention } : {}),
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
  });

  return chat;
}

/**
 * Create a ChatOpenAI instance from a spec with optional streaming flag.
 * Alias of createChatModelFromSpec for backward compatibility.
 * @param {object} modelSpec
 * @param {object} options
 * @returns {ChatOpenAI}
 */
export function createChatModel(specOrOptions = {}, maybeOptions = {}) {
  const looksLikeOptions =
    specOrOptions &&
    typeof specOrOptions === "object" &&
    (Object.prototype.hasOwnProperty.call(specOrOptions, "globalConfig") ||
      Object.prototype.hasOwnProperty.call(specOrOptions, "userConfig") ||
      Object.prototype.hasOwnProperty.call(specOrOptions, "streaming")) &&
    !Object.prototype.hasOwnProperty.call(specOrOptions, "model");

  if (looksLikeOptions) {
    const options = specOrOptions || {};
    const globalConfig = options?.globalConfig || {};
    const userConfig = options?.userConfig || {};
    const modelSpec = resolveDefaultModelSpec({ globalConfig, userConfig });
    return createChatModelFromSpec(modelSpec, options);
  }

  return createChatModelFromSpec(specOrOptions, maybeOptions);
}

/**
 * Create a ChatOpenAI instance by looking up model name in config.
 * @param {string} modelName
 * @param {object} config
 * @param {object} [config.globalConfig]
 * @param {object} [config.userConfig]
 * @param {boolean} [config.streaming]
 * @returns {ChatOpenAI}
 */
export function createChatModelByName(modelName, config = {}) {
  const options = config && typeof config === "object" ? config : {};
  const globalConfig = options?.globalConfig || {};
  const userConfig = options?.userConfig || {};

  const spec = resolveModelSpecByName({ name: modelName, globalConfig, userConfig });
  if (!spec) {
    throw fatalSystemError(tSystem("model.notFoundByName"), {
      code: ERROR_CODE.FATAL_MODEL_NOT_FOUND,
      details: { name: modelName },
    });
  }
  return createChatModelFromSpec(spec, options);
}
