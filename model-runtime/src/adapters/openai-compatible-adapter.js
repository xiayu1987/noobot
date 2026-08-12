/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ChatOpenAI } from "@langchain/openai";
import { compileProviderModelKwargs } from "../policies/cache-policy-engine.js";
import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { executeOpenAiOperation } from "./openai-capability-adapter.js";

const OPENAI_COMPATIBLE_FORMAT = "openai_compatible";

export function resolveUseResponsesApi(spec = {}) {
  if (typeof spec.useResponsesApi === "boolean") return spec.useResponsesApi;
  if (typeof spec.use_responses_api === "boolean") return spec.use_responses_api;
  return spec.format === OPENAI_COMPATIBLE_FORMAT && /codex/.test(spec.model.toLowerCase());
}

function applyInvocationOverrides(target, overrides = {}) {
  if (!target || typeof target.invocationParams !== "function") return target;
  const entries = Object.entries(overrides || {});
  if (!entries.length) return target;
  const originalInvocationParams = target.invocationParams.bind(target);
  target.invocationParams = (...args) => {
    const params = originalInvocationParams(...args);
    const next = { ...(params && typeof params === "object" ? params : {}), ...overrides };
    if (Object.prototype.hasOwnProperty.call(overrides, "reasoning_effort")) {
      next.reasoning_effort = overrides.reasoning_effort;
      if (next.reasoning && typeof next.reasoning === "object") {
        next.reasoning = { ...next.reasoning, effort: overrides.reasoning_effort };
      }
    }
    return next;
  };
  return target;
}

export function bindOpenAiCompatibleTools(client, tools = [], toolOptions = {}, invokeOverrides = {}) {
  const bound = client.bindTools(tools, toolOptions);
  applyInvocationOverrides(bound, invokeOverrides);
  applyInvocationOverrides(bound?.completions, invokeOverrides);
  applyInvocationOverrides(bound?.responses, invokeOverrides);
  return bound;
}

export function createOpenAiCompatibleClient({
  modelSpec,
  credential,
  streaming = false,
  headers = {},
  flow = "agent.main",
}) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  const modelKwargs = compileProviderModelKwargs(spec, flow);
  const promptCacheKey = modelKwargs.prompt_cache_key;
  const promptCacheRetention = modelKwargs.prompt_cache_retention;
  const defaultHeaders = { ...headers };
  const configuration = { defaultHeaders, ...(spec.base_url ? { baseURL: spec.base_url } : {}) };
  const sampling = {};
  if (spec.temperature !== undefined && spec.top_p === undefined) sampling.temperature = Number(spec.temperature);
  return new ChatOpenAI({
    model: spec.model,
    ...sampling,
    streaming: streaming === true,
    maxTokens: spec.max_tokens !== undefined ? Number(spec.max_tokens) : undefined,
    apiKey: credential,
    configuration,
    useResponsesApi: resolveUseResponsesApi(spec),
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(promptCacheRetention ? { promptCacheRetention } : {}),
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
  });
}

export const openAiCompatibleAdapter = Object.freeze({
  id: "openai-compatible",
  formats: Object.freeze([OPENAI_COMPATIBLE_FORMAT]),
  classifyError: classifyTransportError,
  createClient(input) {
    return createOpenAiCompatibleClient(input);
  },
  bindTools({ client, tools, toolOptions, invokeOptions }) {
    return bindOpenAiCompatibleTools(client, tools, toolOptions, invokeOptions);
  },
  executeOperation(input) {
    return executeOpenAiOperation(input);
  },
});
