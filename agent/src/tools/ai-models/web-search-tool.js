/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_OPERATION_KIND } from "@noobot/model-protocol";
import { mergeConfig } from "../../config/index.js";
import { resolveModelSpecByName } from "../../models/index.js";
import { recoverableToolError } from "../../shared/errors/index.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { browserLikeFetch } from "../../shared/utils/web/fetch.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_NAME, TOOL_RESULT_STATUS, WEB_SEARCH_MODE } from "../constants/index.js";
import { isPlainObject, text, isFunction, isObjectLike } from "@noobot/shared/value";

const WEB_SEARCH_FLOW_NAME = "agent.do_search_web";
const WEB_SEARCH_PURPOSE_NAME = "do_search_web";
const WEB_SEARCH_DOMAIN_NAME = "tool";
const WEB_SEARCH_SERVICE_ENDPOINT_NAME = "search";

function tWebSearch(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.do_search_web.${text(key)}`, params);
}

function resolveSearchModelSpec({ modelName, globalConfig, userConfig }) {
  const alias = typeof modelName === "string" ? modelName.trim() : "";
  if (!alias) throw new TypeError("tools.do_search_web.model_web_search.model is required");
  const modelSpec = resolveModelSpecByName({ modelName: alias, globalConfig, userConfig });
  if (!modelSpec) throw new TypeError(`web search model not found: ${alias}`);
  return modelSpec;
}

const WEB_SEARCH_MODES = Object.freeze(Object.values(WEB_SEARCH_MODE));

function normalizeWebSearchMode(mode = "") {
  const normalizedMode = text(mode).toLowerCase();
  if (!normalizedMode) throw new TypeError("tools.do_search_web.mode is required");
  if (!WEB_SEARCH_MODES.includes(normalizedMode)) {
    throw new TypeError(
      `unsupported web search mode: ${normalizedMode}; expected one of ${WEB_SEARCH_MODES.join(", ")}`,
    );
  }
  return normalizedMode;
}

function resolveWebSearchToolConfig(runtime = {}) {
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  return effectiveConfig?.tools?.[TOOL_NAME.DO_SEARCH_WEB] || {};
}

function resolveModelWebSearchConfig(toolCfg = {}) {
  const config = toolCfg?.model_web_search;
  if (!isObjectLike(config)) {
    throw new TypeError("tools.do_search_web.model_web_search is required");
  }
  return config;
}

function resolveSearchEngineConfig(toolCfg = {}) {
  const nestedConfig =
    toolCfg?.search_engine && typeof toolCfg.search_engine === "object"
      ? toolCfg.search_engine
      : {};
  return {
    ...nestedConfig,
    enabled: toolCfg?.enabled,
    mode: WEB_SEARCH_MODE.SEARCH_ENGINE,
  };
}

function parseQueryStringFormat(format = "") {
  const raw = text(format);
  if (!raw) return { key: "q", value: "" };
  const [key, ...rest] = raw.split("=");
  return { key: text(key) || "q", value: rest.join("=") };
}

function parseBodyFormat(bodyFormat = "{}") {
  const raw = text(bodyFormat) || "{}";
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function buildSearchEngineRequest({ toolCfg = {}, query = "" }) {
  const endpointCfg = toolCfg?.endpoints?.[WEB_SEARCH_SERVICE_ENDPOINT_NAME] || {};
  const endpointUrl = text(endpointCfg?.url);
  const { key: queryKey } = parseQueryStringFormat(endpointCfg?.query_string_format);
  const url = new URL(endpointUrl);
  url.searchParams.set(queryKey, text(query));
  const body = parseBodyFormat(endpointCfg?.body_format || "{}");
  const method = body && Object.keys(body).length > 0 ? "POST" : "GET";
  const apiKey = text(toolCfg?.api_key);
  const headers = {
    Accept: "application/json, text/plain, */*",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
  return {
    url: url.toString(),
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ ...body, [queryKey]: text(query) }) : undefined,
    endpointCfg,
    queryString: { [queryKey]: text(query) },
  };
}

export async function searchWithSearchEngine({ runtime = {}, toolCfg = {}, query = "" }) {
  const endpointCfg = toolCfg?.endpoints?.[WEB_SEARCH_SERVICE_ENDPOINT_NAME] || {};
  const endpointUrl = text(endpointCfg?.url);
  if (!endpointUrl) {
    throw recoverableToolError(tWebSearch(runtime, "searchEngineUrlMissing"), {
      code: ERROR_CODE.RECOVERABLE_ENDPOINT_URL_MISSING,
    });
  }
  const request = buildSearchEngineRequest({ toolCfg, query });
  const response = await browserLikeFetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body ? { body: request.body } : {}),
    signal: runtime?.abortSignal || undefined,
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return {
    ok: response.ok,
    statusCode: response.status,
    url: request.url,
    queryString: request.queryString,
    data,
  };
}

export function createWebSearchTool({ agentContext }) {
  const runtime = agentContext?.bindings?.runtime || {};
  const toolCfg = resolveWebSearchToolConfig(runtime);
  const toolEnabled = toolCfg?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};

  return [
    new DynamicStructuredTool({
      name: TOOL_NAME.DO_SEARCH_WEB,
      description: tTool(runtime, "tools.do_search_web.description"),
      schema: z.object({
        query: z.string().describe(tTool(runtime, "tools.do_search_web.fieldQuery")),
      }),
      func: async ({ query }) => {
        const normalizedQuery = text(query);
        let resolvedModelSpec = null;
        if (!normalizedQuery) {
          throw recoverableToolError(tWebSearch(runtime, "queryRequired"), {
            code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
          });
        }
        try {
          const mode = normalizeWebSearchMode(toolCfg?.mode);
          if (mode === WEB_SEARCH_MODE.SEARCH_ENGINE) {
            const searchEngineCfg = resolveSearchEngineConfig(toolCfg);
            const searchEngineResult = await searchWithSearchEngine({
              runtime,
              toolCfg: searchEngineCfg,
              query: normalizedQuery,
            });
            return toToolJsonResult(
              TOOL_NAME.DO_SEARCH_WEB,
              {
                ok: searchEngineResult?.ok !== false,
                status: TOOL_RESULT_STATUS.COMPLETED,
                mode,
                query: normalizedQuery,
                ...searchEngineResult,
              },
              true,
            );
          }
          const modelWebSearchCfg = resolveModelWebSearchConfig(toolCfg);
          resolvedModelSpec = resolveSearchModelSpec({
            modelName: modelWebSearchCfg.model,
            globalConfig,
            userConfig,
          });
          const modelPort = runtime?.modelPort;
          if (!modelPort || !isFunction(modelPort.invoke)) {
            throw new TypeError("web search requires runtime.modelPort");
          }
          const response = await modelPort.invoke({
            model: resolvedModelSpec,
            messages: [],
            operation: {
              kind: MODEL_OPERATION_KIND.WEB_SEARCH,
              input: { query: normalizedQuery },
            },
            options: {
              signal: runtime?.abortSignal || undefined,
              locale: runtime?.systemRuntime?.config?.locale || runtime?.locale || "zh-CN",
            },
            invocation: {
              flow: WEB_SEARCH_FLOW_NAME,
              purpose: WEB_SEARCH_PURPOSE_NAME,
              domain: WEB_SEARCH_DOMAIN_NAME,
              contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
            },
          });
          const searchResult = response.result;
          return toToolJsonResult(
            TOOL_NAME.DO_SEARCH_WEB,
            {
              ok: true,
              status: TOOL_RESULT_STATUS.COMPLETED,
              mode,
              provider: response.execution.provider,
              modelAlias: text(resolvedModelSpec?.alias),
              model: text(resolvedModelSpec?.model),
              query: normalizedQuery,
              text: searchResult.rawText,
              sources: searchResult.sources,
            },
            true,
          );
        } catch (error) {
          if (error?.isRecoverable || error?.recoverable) throw error;
          const errorMessage = text(error?.message) || String(error || "");
          throw recoverableToolError(errorMessage || tWebSearch(runtime, "searchFailed"), {
            code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_ERROR),
            details: {
              modelAlias: text(resolvedModelSpec?.alias),
              model: text(resolvedModelSpec?.model),
            },
          });
        }
      },
    }),
  ];
}
