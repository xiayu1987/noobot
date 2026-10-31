/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { tool as structuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_OPERATION_KIND } from "@noobot/model-protocol";
import { mergeConfig } from "../../config/index.js";
import { resolveModelSpecByName } from "../../models/index.js";
import { NoobotError, recoverableToolError } from "../../shared/errors/index.js";
import { isAbortError, resolveErrorMessage } from "../../shared/utils/error-utils.js";
import { ERROR_CODE } from "../../shared/errors/constants.js";
import { browserLikeFetch } from "../../shared/utils/web/fetch.js";
import { toToolJsonResult } from "../core/tool-json-result.js";
import { tTool } from "../core/tool-i18n.js";
import { getRuntimeFromAgentContext } from "../../context/agent-context-accessor.js";
import { requireRuntimeModelHost } from "../../runtime/model-port-host.js";
import { TOOL_NAME, WEB_SEARCH_MODE } from "../constants/index.js";
import { isPlainObject, text, isObjectLike } from "@noobot/shared/value";

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

export async function searchWithSearchEngine({ runtime, toolCfg, query, abortSignal }) {
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
    signal: abortSignal,
  });
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw recoverableToolError(`${tWebSearch(runtime, "searchFailed")}: HTTP ${response.status}`, {
      code: ERROR_CODE.RECOVERABLE_WEB_SEARCH_HTTP_ERROR,
      details: { httpStatus: response.status, url: request.url, data },
    });
  }
  return {
    url: request.url,
    queryString: request.queryString,
    data,
  };
}

export function createWebSearchTool({ agentContext }) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const toolCfg = resolveWebSearchToolConfig(runtime);
  const toolEnabled = toolCfg?.enabled !== false;
  if (!toolEnabled) return [];

  const globalConfig = runtime?.globalConfig || {};
  const userConfig = runtime?.userConfig || {};

  return [
    structuredTool(
      async ({ query }, toolConfig) => {
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
              abortSignal: toolConfig.signal,
            });
            return toToolJsonResult(
              TOOL_NAME.DO_SEARCH_WEB,
              {
                ok: true,
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
          const { modelPort } = requireRuntimeModelHost(runtime);
          const response = await modelPort.invoke({
            model: resolvedModelSpec,
            messages: [],
            operation: {
              kind: MODEL_OPERATION_KIND.WEB_SEARCH,
              input: { query: normalizedQuery },
            },
            options: {
              signal: toolConfig.signal,
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
          if (error instanceof NoobotError || isAbortError(error, toolConfig.signal)) throw error;
          throw recoverableToolError(
            `${tWebSearch(runtime, "searchFailed")}: ${resolveErrorMessage(error)}`,
            {
              code: ERROR_CODE.RECOVERABLE_WEB_SEARCH_FAILED,
              cause: error,
              details: {
                modelAlias: text(resolvedModelSpec?.alias),
                model: text(resolvedModelSpec?.model),
              },
            },
          );
        }
      },
      {
        name: TOOL_NAME.DO_SEARCH_WEB,
        description: tTool(runtime, "tools.do_search_web.description"),
        schema: z.object({
          query: z.string().describe(tTool(runtime, "tools.do_search_web.fieldQuery")),
        }),
      },
    ),
  ];
}
