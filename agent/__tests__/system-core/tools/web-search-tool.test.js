/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchEngineRequest,
  searchWithOpenaiResponsesApi,
  searchWithSearchEngine,
} from "../../../src/system-core/tools/ai-models/web-search-tool.js";

test("web_search: Responses API 调用应启用 web_search 工具", async () => {
  let capturedRequest = null;
  let capturedOptions = null;
  const abortController = new AbortController();
  const openaiClient = {
    responses: {
      create: async (request, options) => {
        capturedRequest = request;
        capturedOptions = options;
        return {
          output_text: "search result",
          output: [{ type: "message" }],
        };
      },
    },
  };

  const result = await searchWithOpenaiResponsesApi({
    openaiClient,
    modelName: "gpt-5.5",
    query: "latest noobot news",
    abortSignal: abortController.signal,
  });

  assert.deepEqual(capturedRequest?.tools, [{ type: "web_search" }]);
  assert.equal(capturedOptions?.signal, abortController.signal);
  assert.equal(capturedRequest?.model, "gpt-5.5");
  const inputText = capturedRequest?.input?.[0]?.content?.[0]?.text;
  assert.match(inputText, /必须使用网页搜索/);
  assert.match(inputText, /不要只依赖模型已有知识/);
  assert.match(inputText, /latest noobot news/);
  assert.equal(result.rawText, "search result");
  assert.deepEqual(result.output, [{ type: "message" }]);
});

test("web_search: search_engine 模式按配置生成直连搜索引擎请求", () => {
  const toolCfg = {
    enabled: true,
    mode: "search_engine",
    api_key: "secret",
    prompt: "优先用于补充实时或外部网页信息",
    endpoints: {
      search: {
        description: "搜索网页",
        prompt: "返回可引用的检索结果摘要与来源。",
        custom_param_format: "searx实例地址",
        custom_param: "http://searxng.local",
        url: "http://search.local/search",
        query_string_format: "q=搜索内容",
        body_format: "{}",
      },
    },
  };

  const request = buildSearchEngineRequest({
    toolCfg,
    query: "noobot web search",
  });

  assert.equal(request.url, "http://search.local/search?q=noobot+web+search");
  assert.equal(request.method, "GET");
  assert.equal(request.headers.Authorization, "Bearer secret");
  assert.equal(request.headers["X-Noobot-Custom-Param"], "http://searxng.local");
  assert.deepEqual(request.queryString, { q: "noobot web search" });
  assert.equal(request.customParam, "http://searxng.local");
  assert.equal(request.body, undefined);
});

test("web_search: search_engine 模式直接请求搜索引擎地址", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedOptions = null;
  const abortController = new AbortController();
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ results: [{ title: "Noobot" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await searchWithSearchEngine({
      runtime: { abortSignal: abortController.signal },
      toolCfg: {
        enabled: true,
        mode: "search_engine",
        endpoints: {
          search: {
            url: "http://search.local/search",
            query_string_format: "q=搜索内容",
            body_format: "{}",
          },
        },
      },
      query: "noobot",
    });

    assert.equal(capturedUrl, "http://search.local/search?q=noobot");
    assert.equal(capturedOptions.method, "GET");
    assert.equal(capturedOptions.signal, abortController.signal);
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.data, { results: [{ title: "Noobot" }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("web_search: search_engine 模式缺少 endpoints.search.url 时报错", async () => {
  await assert.rejects(
    () =>
      searchWithSearchEngine({
        runtime: {},
        toolCfg: {
          enabled: true,
          mode: "search_engine",
          endpoints: { search: {} },
        },
        query: "noobot",
      }),
    /endpoints\.search\.url|搜索引擎模式需要配置/,
  );
});
