/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { DynamicStructuredTool } from "@langchain/core/tools";
import OpenAI from "openai";
import { z } from "zod";
import { mergeConfig } from "../../config/index.js";
import { resolveDefaultModelSpec, resolveModelSpecByName } from "../../model/index.js";
import { buildPluginModelHeaders, MODEL_NAME_HEADER_KEY, PARENT_SESSION_HEADER_KEY } from "../../model/headers/plugin-headers.js";
import { resolveParentSessionId } from "../../context/parent-session-id-resolver.js";
import { recoverableToolError } from "../../error/index.js";
import { ERROR_CODE } from "../../error/constants.js";
import { browserLikeFetch } from "../../utils/web/fetch.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { TOOL_CALL_MODE, TOOL_NAME, TOOL_RESULT_STATUS } from "../constants/index.js";

const WEB_SEARCH_FLOW_NAME = "agent.web_search";
const WEB_SEARCH_PURPOSE_NAME = "web_search";
const WEB_SEARCH_DOMAIN_NAME = "tool";
const OPENAI_WEB_SEARCH_TOOL_TYPE = "web_search_preview";
const WEB_SEARCH_MODE_RESPONSES_API = "responses_api";
const WEB_SEARCH_MODE_SEARCH_ENGINE = "search_engine";
const WEB_SEARCH_SERVICE_ENDPOINT_NAME = "search";

function buildWebSearchInputText(query = "") {
  const normalizedQuery = String(query || "").trim();
  return [
    "请使用网页搜索工具检索最新、可靠的信息，并基于搜索结果回答。",
    "必须使用网页搜索，不要只依赖模型已有知识。",
    "搜索问题：",
    normalizedQuery,
  ].join("\n");
}

function tWebSearch(runtime = {}, key = "", params = {}) {
  return tTool(runtime, `tools.web_search.${String(key || "").trim()}`, params);
}

function resolveModelApiKey(modelSpec = {}) {
  return String(modelSpec?.api_key || "").trim();
}

function resolveModelBaseUrl(modelSpec = {}) {
  return String(modelSpec?.base_url || "").trim();
}

function buildWebSearchRequestHeaders(modelName = "", runtime = {}) {
  const sessionId = String(
    runtime?.systemRuntime?.sessionId || runtime?.systemRuntime?.rootSessionId || "",
  ).trim();
  const parentSessionId = resolveParentSessionId({ runtime });
  return {
    [MODEL_NAME_HEADER_KEY]: String(modelName || "").trim() || "unknown_model",
    ...buildPluginModelHeaders({
      flow: WEB_SEARCH_FLOW_NAME,
      purpose: WEB_SEARCH_PURPOSE_NAME,
      domain: WEB_SEARCH_DOMAIN_NAME,
      sessionId,
    }),
    ...(parentSessionId ? { [PARENT_SESSION_HEADER_KEY]: parentSessionId } : {}),
  };
}

function resolveSearchModelSpec({ modelName = "", runtimeModel = "", globalConfig = {}, userConfig = {} }) {
  const preferredModelName = String(modelName || "").trim();
  const currentRuntimeModel = String(runtimeModel || "").trim();
  const resolvedModelName = preferredModelName || currentRuntimeModel;
  const resolvedModelSpec = resolvedModelName
    ? resolveModelSpecByName({
        modelName: resolvedModelName,
        globalConfig,
        userConfig,
        fallbackToDefault: true,
      })
    : resolveDefaultModelSpec({ globalConfig, userConfig });
  return { resolvedModelName, resolvedModelSpec };
}

export async function searchWithOpenaiResponsesApi({ openaiClient, modelName, query }) {
  const searchResult = await openaiClient.responses.create({
    model: String(modelName || "").trim(),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildWebSearchInputText(query),
          },
        ],
      },
    ],
    tools: [{ type: OPENAI_WEB_SEARCH_TOOL_TYPE }],
  });
  return {
    rawText: String(searchResult?.output_text || "").trim(),
    output: Array.isArray(searchResult?.output) ? searchResult.output : [],
  };
}

function normalizeWebSearchMode(mode = "") {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (normalizedMode === WEB_SEARCH_MODE_SEARCH_ENGINE) return WEB_SEARCH_MODE_SEARCH_ENGINE;
  return WEB_SEARCH_MODE_RESPONSES_API;
}

function resolveWebSearchToolConfig(runtime = {}) {
  const effectiveConfig = mergeConfig(runtime?.globalConfig || {}, runtime?.userConfig || {});
  return effectiveConfig?.tools?.[TOOL_NAME.WEB_SEARCH] || {};
}

function resolveResponsesApiConfig(toolCfg = {}) {
  return toolCfg?.responses_api && typeof toolCfg.responses_api === "object"
    ? toolCfg.responses_api
    : {};
}

function resolveSearchEngineConfig(toolCfg = {}) {
  const nestedConfig = toolCfg?.search_engine && typeof toolCfg.search_engine === "object"
    ? toolCfg.search_engine
    : {};
  return {
    ...nestedConfig,
    enabled: toolCfg?.enabled,
    mode: WEB_SEARCH_MODE_SEARCH_ENGINE,
  };
}

function resolveSearchEngineCustomParam(toolCfg = {}, endpointCfg = {}) {
  return String(
    endpointCfg?.custom_param ||
      endpointCfg?.customParam ||
      toolCfg?.custom_param ||
      toolCfg?.customParam ||
      toolCfg?.search_engine_address ||
      toolCfg?.searchEngineAddress ||
      "",
  ).trim();
}

function parseQueryStringFormat(format = "") {
  const raw = String(format || "").trim();
  if (!raw) return { key: "q", value: "" };
  const [key, ...rest] = raw.split("=");
  return { key: String(key || "q").trim() || "q", value: rest.join("=") };
}

function parseBodyFormat(bodyFormat = "{}") {
  const raw = String(bodyFormat || "{}").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function buildSearchEngineRequest({
  toolCfg = {},
  query = "",
}) {
  const endpointCfg = toolCfg?.endpoints?.[WEB_SEARCH_SERVICE_ENDPOINT_NAME] || {};
  const endpointUrl = String(endpointCfg?.url || "").trim();
  const { key: queryKey } = parseQueryStringFormat(endpointCfg?.query_string_format || "q=搜索内容");
  const url = new URL(endpointUrl);
  url.searchParams.set(queryKey, String(query || "").trim());
  const body = parseBodyFormat(endpointCfg?.body_format || "{}");
  const method = body && Object.keys(body).length > 0 ? "POST" : "GET";
  const apiKey = String(toolCfg?.api_key || "").trim();
  const customParam = resolveSearchEngineCustomParam(toolCfg, endpointCfg);
  const headers = {
    Accept: "application/json, text/plain, */*",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(customParam ? { "X-Noobot-Custom-Param": customParam } : {}),
  };
  return {
    url: url.toString(),
    method,
    headers,
    body: method === "POST" ? JSON.stringify({ ...body, [queryKey]: String(query || "").trim() }) : undefined,
    endpointCfg,
    queryString: { [queryKey]: String(query || "").trim() },
    customParam,
  };
}

export async function searchWithSearchEngine({
  runtime = {},
  toolCfg = {},
  query = "",
}) {
  const endpointCfg = toolCfg?.endpoints?.[WEB_SEARCH_SERVICE_ENDPOINT_NAME] || {};
  const endpointUrl = String(endpointCfg?.url || "").trim();
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
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  return {
    ok: response.ok,
    statusCode: response.status,
    url: request.url,
    queryString: request.queryString,
    customParam: request.customParam,
    data,
  };
}

export function createWebSearchTool({ agentContext }) {
  const runtime = agentContext?.runtime || {};
  const toolCfg = resolveWebSearchToolConfig(runtime);
  const toolEnabled = toolCfg?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};

  return [
    new DynamicStructuredTool({
      name: TOOL_NAME.WEB_SEARCH,
      description: tTool(runtime, "tools.web_search.description"),
      schema: z.object({
        query: z.string().describe(tTool(runtime, "tools.web_search.fieldQuery")),
        model_name: z
          .string()
          .optional()
          .describe(tTool(runtime, "tools.web_search.fieldModelName")),
      }),
      func: async ({ query, model_name = "" }) => {
        const normalizedQuery = String(query || "").trim();
        let resolvedModelSpec = null;
        if (!normalizedQuery) {
          throw recoverableToolError(tWebSearch(runtime, "queryRequired"), {
            code: ERROR_CODE.RECOVERABLE_INPUT_MISSING,
          });
        }
        try {
          const mode = normalizeWebSearchMode(toolCfg?.mode);
          if (mode === WEB_SEARCH_MODE_SEARCH_ENGINE) {
            const searchEngineCfg = resolveSearchEngineConfig(toolCfg);
            const searchEngineResult = await searchWithSearchEngine({
              runtime,
              toolCfg: searchEngineCfg,
              query: normalizedQuery,
            });
            return toToolJsonResult(
              TOOL_NAME.WEB_SEARCH,
              {
                ok: searchEngineResult?.ok !== false,
                status: TOOL_RESULT_STATUS.COMPLETED,
                callMode: "search_engine",
                mode,
                query: normalizedQuery,
                ...searchEngineResult,
              },
              true,
            );
          }
          const responsesApiCfg = resolveResponsesApiConfig(toolCfg);
          const { resolvedModelName, resolvedModelSpec: selectedModelSpec } = resolveSearchModelSpec({
            modelName: model_name || responsesApiCfg?.model,
            runtimeModel: runtime?.runtimeModel,
            globalConfig,
            userConfig,
          });
          resolvedModelSpec = selectedModelSpec;
          const modelNameForSearch = String(
            resolvedModelSpec?.model || resolvedModelName || "",
          ).trim();
          const modelApiKey = resolveModelApiKey(resolvedModelSpec || {});
          if (!modelApiKey) {
            throw recoverableToolError(tWebSearch(runtime, "modelApiKeyMissing"), {
              code: ERROR_CODE.RECOVERABLE_MODEL_API_KEY_MISSING,
              details: {
                modelAlias: String(resolvedModelSpec?.alias || "").trim(),
                model: String(resolvedModelSpec?.model || "").trim(),
              },
            });
          }
          const openaiClient = new OpenAI({
            apiKey: modelApiKey,
            ...(resolveModelBaseUrl(resolvedModelSpec || {})
              ? { baseURL: resolveModelBaseUrl(resolvedModelSpec || {}) }
              : {}),
            defaultHeaders: buildWebSearchRequestHeaders(modelNameForSearch, runtime),
          });
          const searchResult = await searchWithOpenaiResponsesApi({
            openaiClient,
            modelName: modelNameForSearch,
            query: normalizedQuery,
          });
          return toToolJsonResult(
            TOOL_NAME.WEB_SEARCH,
            {
              ok: true,
              status: TOOL_RESULT_STATUS.COMPLETED,
              callMode: TOOL_CALL_MODE.OPENAI_RESPONSES_API,
              modelAlias: String(resolvedModelSpec?.alias || "").trim(),
              model: String(resolvedModelSpec?.model || "").trim(),
              query: normalizedQuery,
              text: searchResult.rawText,
              output: searchResult.output,
              summary: {
                output_item_count: searchResult.output.length,
              },
            },
            true,
          );
        } catch (error) {
          if (error?.isRecoverable || error?.recoverable) throw error;
          const errorMessage = String(error?.message || String(error || "")).trim();
          throw recoverableToolError(errorMessage || tWebSearch(runtime, "searchFailed"), {
            code: String(error?.code || ERROR_CODE.RECOVERABLE_TOOL_ERROR),
            details: {
              modelAlias: String(resolvedModelSpec?.alias || "").trim(),
              model: String(resolvedModelSpec?.model || "").trim(),
            },
          });
        }
      },
    }),
  ];
}
