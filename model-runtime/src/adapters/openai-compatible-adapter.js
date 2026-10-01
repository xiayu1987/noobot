/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ChatOpenAI } from "@langchain/openai";
import { MODEL_PROVIDER_ID } from "@noobot/model-protocol";
import {
  applyPromptCacheMessages,
  compileProviderModelKwargs,
  resolvePromptCacheHeaders,
} from "../policies/cache-policy-engine.js";
import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import { classifyTransportError } from "../policies/default-retry-policy.js";
import { executeOpenAiOperation } from "./openai-capability-adapter.js";

export function resolveUseResponsesApi(spec = {}) {
  if (typeof spec.useResponsesApi === "boolean") return spec.useResponsesApi;
  if (typeof spec.use_responses_api === "boolean") return spec.use_responses_api;
  return /codex/.test(String(spec.model || "").toLowerCase());
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

export function orderOpenAiResponsesRequestBody(request = {}) {
  const { input, ...stableRequest } = request;
  return { ...stableRequest, input };
}

function applyOpenAiResponsesRequestOrder(client) {
  const responses = client.responses;
  const completionWithRetry = responses.completionWithRetry.bind(responses);
  responses.completionWithRetry = (request, requestOptions) =>
    completionWithRetry(orderOpenAiResponsesRequestBody(request), requestOptions);
  return client;
}

export function bindOpenAiCompatibleTools(
  client,
  tools = [],
  toolOptions = {},
  invokeOverrides = {},
) {
  const bound = client.bindTools(tools, toolOptions);
  const { signal, callbacks, ...requestOverrides } = invokeOverrides;
  applyInvocationOverrides(bound, requestOverrides);
  applyInvocationOverrides(bound?.completions, requestOverrides);
  const toolChoice = requestOverrides.tool_choice ?? toolOptions.tool_choice;
  applyInvocationOverrides(bound?.responses, {
    ...requestOverrides,
    ...(["auto", "required", "none"].includes(toolChoice) ? { tool_choice: toolChoice } : {}),
  });
  return applyOpenAiResponsesRequestOrder(bound);
}

export function createOpenAiCompatibleClient({
  modelSpec,
  credential,
  streaming = false,
  headers = {},
  flow = "agent.main",
  fetch: transportFetch,
  maxRetries,
}) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  const useResponsesApi = resolveUseResponsesApi(spec);
  const cacheTransport = { useResponsesApi };
  const modelKwargs = compileProviderModelKwargs(spec, flow, cacheTransport);
  const promptCacheKey = modelKwargs.prompt_cache_key;
  const maxTokens = spec.max_tokens !== undefined ? Number(spec.max_tokens) : undefined;
  if (spec.operatorId === MODEL_PROVIDER_ID.OPENAI && !useResponsesApi && maxTokens !== undefined) {
    modelKwargs.max_completion_tokens = maxTokens;
  }
  const defaultHeaders = {
    ...headers,
    ...resolvePromptCacheHeaders(spec, flow, cacheTransport),
  };
  const configuration = {
    defaultHeaders,
    ...(spec.base_url ? { baseURL: spec.base_url } : {}),
    ...(transportFetch ? { fetch: transportFetch } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  };
  const sampling = spec.temperature !== undefined ? { temperature: spec.temperature } : {};
  const client = new ChatOpenAI({
    model: spec.model,
    ...sampling,
    streaming: streaming === true,
    maxTokens:
      spec.operatorId === MODEL_PROVIDER_ID.OPENAI && !useResponsesApi ? undefined : maxTokens,
    apiKey: credential,
    configuration,
    useResponsesApi,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
  });
  applyInvocationOverrides(client, modelKwargs);
  return applyOpenAiResponsesRequestOrder(client);
}

export const openAiCompatibleAdapter = Object.freeze({
  id: "openai-compatible",
  classifyError: classifyTransportError,
  createClient(input) {
    return createOpenAiCompatibleClient(input);
  },
  bindTools({ client, tools, toolOptions, invokeOptions }) {
    return bindOpenAiCompatibleTools(client, tools, toolOptions, invokeOptions);
  },
  prepareMessages({ modelSpec, messages }) {
    return applyPromptCacheMessages(normalizeRuntimeModelSpec(modelSpec), messages);
  },
  executeOperation(input) {
    return executeOpenAiOperation(input);
  },
});
