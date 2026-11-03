/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ChatOpenAI } from "@langchain/openai";
import {
  MODEL_PROVIDER_ID,
  MODEL_RESPONSE_SOURCE,
  resolveModelUseResponsesApi,
} from "@noobot/model-protocol";
import {
  applyPromptCacheMessages,
  compileProviderModelKwargs,
  resolvePromptCacheHeaders,
} from "../policies/cache-policy-engine.js";
import { normalizeRuntimeModelSpec } from "../normalization/spec-normalizer.js";
import {
  executeOpenAiOperation,
  resolveOpenAiOperationStreamingModes,
} from "./openai-capability-adapter.js";
import { classifyOpenAiError } from "./openai-error-classification.js";
import { guardResponsesStream } from "./openai-responses-stream.js";
import { createResponseModeFetch, unwrapModelProtocolError } from "./response-mode.js";
import { isObjectLike } from "@noobot/shared/value";

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
      if (isObjectLike(next.reasoning)) {
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

async function surfaceProtocolError(call) {
  try {
    return await call();
  } catch (error) {
    throw unwrapModelProtocolError(error);
  }
}

function guardOpenAiClient(client) {
  const { responses, completions } = client;
  const responsesCompletion = responses.completionWithRetry.bind(responses);
  responses.completionWithRetry = async (request, requestOptions) => {
    const result = await surfaceProtocolError(() =>
      responsesCompletion(orderOpenAiResponsesRequestBody(request), requestOptions),
    );
    return request?.stream === true ? guardResponsesStream(result) : result;
  };
  const completionsCompletion = completions.completionWithRetry.bind(completions);
  completions.completionWithRetry = (request, requestOptions) =>
    surfaceProtocolError(() => completionsCompletion(request, requestOptions));
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
  return guardOpenAiClient(bound);
}

export function createOpenAiCompatibleClient({
  modelSpec,
  credential,
  streaming = false,
  headers = {},
  flow = "agent.main",
  fetch: transportFetch = globalThis.fetch,
}) {
  const spec = normalizeRuntimeModelSpec(modelSpec);
  const useResponsesApi = resolveModelUseResponsesApi(spec);
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
    fetch: createResponseModeFetch({
      requestedStreaming: streaming === true,
      fetch: transportFetch,
    }),
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

    maxRetries: 0,
    ...(promptCacheKey ? { promptCacheKey } : {}),
    ...(Object.keys(modelKwargs).length ? { modelKwargs } : {}),
  });
  applyInvocationOverrides(client, modelKwargs);
  return guardOpenAiClient(client);
}

export const openAiCompatibleAdapter = Object.freeze({
  id: "openai-compatible",
  classifyError: classifyOpenAiError,
  createClient(input) {
    return createOpenAiCompatibleClient(input);
  },
  bindTools({ client, tools, toolOptions, invokeOptions }) {
    return bindOpenAiCompatibleTools(client, tools, toolOptions, invokeOptions);
  },
  prepareMessages({ modelSpec, messages }) {
    return applyPromptCacheMessages(normalizeRuntimeModelSpec(modelSpec), messages);
  },
  resolveResponseSource({ modelSpec }) {
    return resolveModelUseResponsesApi(normalizeRuntimeModelSpec(modelSpec))
      ? MODEL_RESPONSE_SOURCE.RESPONSES
      : MODEL_RESPONSE_SOURCE.MESSAGE;
  },
  executeOperation(input) {
    return executeOpenAiOperation(input);
  },
  resolveOperationStreamingModes(input) {
    return resolveOpenAiOperationStreamingModes(input);
  },
});
