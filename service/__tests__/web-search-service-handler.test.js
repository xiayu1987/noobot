/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_FAILURE_CODE } from "@noobot/agent-config-protocol/service-handler";
import webSearchServiceHandler from "../../user-template/default-user/services/web-search-service-handler.js";

function createUnavailableFetcher(calls) {
  return async (url) => {
    calls.push(String(url));
    return {
      ok: false,
      status: 503,
      statusText: "unavailable",
      headers: { get: () => "text/plain" },
      text: async () => "",
      json: async () => ({}),
    };
  };
}

test("web search reports an invalid custom fallback instance without throwing", async () => {
  const calls = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = await webSearchServiceHandler({
      failureCode: SERVICE_FAILURE_CODE,
      locale: "en-US",
      runtime: { sharedTools: { fetch: createUnavailableFetcher(calls) } },
      endpointCfg: { url: "https://primary.example.invalid/search", custom_param_format: "json" },
      serviceCfg: { fallback_instances: [] },
      custom_param: "not a url",
      queryString: { search: "noobot" },
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, SERVICE_FAILURE_CODE.INPUT_INVALID);
  assert.ok(result.error);
  assert.ok(calls.includes("https://primary.example.invalid/search?q=noobot&format=json"));
});
