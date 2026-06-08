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

const MODEL_NAME_HEADER_KEY = "X-Model-Name";
const FLOW_HEADER_KEY = "X-Harness-Flow";
const PURPOSE_HEADER_KEY = "X-Harness-Purpose";
const DOMAIN_HEADER_KEY = "X-Harness-Domain";
const SESSION_HEADER_KEY = "X-Harness-Session-Id";
const DEFAULT_MAIN_FLOW = "agent.main";
const DEFAULT_MAIN_PURPOSE = "main_agent";
const DEFAULT_MAIN_DOMAIN = "primary";

function supportsTopP(modelSpec = {}) {
  const providerFormat = normalizeProviderFormat(modelSpec?.format || "");
  const modelName = String(modelSpec?.model || "").trim().toLowerCase();
  if (providerFormat === PROVIDER_FORMAT.OPENAI_COMPATIBLE && modelName.includes("gpt-5")) {
    return false;
  }
  return true;
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
    if (Number.isFinite(thinkingBudget) && thinkingBudget > 0) {
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

function buildChatModelConfiguration(normalizedSpec = {}, options = {}) {
  const sessionId = resolveHeaderSessionId(options);
  const defaultHeaders = {
    [MODEL_NAME_HEADER_KEY]: String(normalizedSpec?.model || "").trim(),
    [FLOW_HEADER_KEY]: DEFAULT_MAIN_FLOW,
    [PURPOSE_HEADER_KEY]: DEFAULT_MAIN_PURPOSE,
    [DOMAIN_HEADER_KEY]: DEFAULT_MAIN_DOMAIN,
    ...(sessionId ? { [SESSION_HEADER_KEY]: sessionId } : {}),
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
