/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SERVICE_FAILURE_CODE,
  normalizeServiceHandlerResult,
} from "@noobot/agent-config-protocol/service-handler";
import weatherServiceHandler from "../../../../user-template/default-user/services/weather-service-handler.js";
import webSearchServiceHandler from "../../../../user-template/default-user/services/web-search-service-handler.js";

const WEATHER_ENDPOINT = Object.freeze({
  url: "https://wttr.test",
  custom_param_format: "j1",
  query_string_format: '{"city":""}',
  body_format: "{}",
});
const SEARCH_ENDPOINT = Object.freeze({
  url: "https://search.test/search",
  custom_param_format: "json",
  query_string_format: "search=keyword",
  body_format: "",
});
const textCleaner = Object.freeze({ cleanAny: (input) => input });

const failureCode = SERVICE_FAILURE_CODE;

function runtimeWith(fetch) {
  return { sharedTools: { fetch, textCleaner } };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("weather template returns contract success with httpStatus in output", async () => {
  const result = await weatherServiceHandler({
    runtime: runtimeWith(async () => jsonResponse({ nearest_area: [], current_condition: [] })),
    failureCode,
    endpointCfg: WEATHER_ENDPOINT,
    queryString: { city: "Chongqing" },
  });
  const normalized = normalizeServiceHandlerResult(result);
  assert.equal(normalized.ok, true);
  assert.equal(normalized.output.httpStatus, 200);
  assert.equal(normalized.output.request.url, "https://wttr.test/Chongqing?format=j1");
});

test("weather template reports missing city and upstream failure with named codes", async () => {
  const missing = normalizeServiceHandlerResult(
    await weatherServiceHandler({
      runtime: runtimeWith(async () => assert.fail("must not fetch")),
      failureCode,
      endpointCfg: WEATHER_ENDPOINT,
      queryString: undefined,
    }),
  );
  assert.equal(missing.code, SERVICE_FAILURE_CODE.INPUT_INVALID);
  const upstream = normalizeServiceHandlerResult(
    await weatherServiceHandler({
      runtime: runtimeWith(async () => new Response("busy", { status: 503 })),
      failureCode,
      endpointCfg: WEATHER_ENDPOINT,
      queryString: { city: "Chongqing" },
    }),
  );
  assert.equal(upstream.code, SERVICE_FAILURE_CODE.UPSTREAM_FAILED);
  assert.equal(upstream.output.httpStatus, 503);
});

test("web-search template maps primary success and 4xx rejection to the contract", async () => {
  const ok = normalizeServiceHandlerResult(
    await webSearchServiceHandler({
      runtime: runtimeWith(async () => jsonResponse({ results: [] })),
      locale: "en-US",
      failureCode,
      endpointCfg: SEARCH_ENDPOINT,
      serviceCfg: {},
      queryString: { search: "noobot" },
    }),
  );
  assert.deepEqual(ok.output, { httpStatus: 200, source: "primary", data: { results: [] } });
  const rejected = normalizeServiceHandlerResult(
    await webSearchServiceHandler({
      runtime: runtimeWith(async () => jsonResponse({ error: "bad" }, 403)),
      locale: "en-US",
      failureCode,
      endpointCfg: SEARCH_ENDPOINT,
      serviceCfg: {},
      queryString: { search: "noobot" },
    }),
  );
  assert.equal(rejected.code, SERVICE_FAILURE_CODE.UPSTREAM_FAILED);
  assert.equal(rejected.output.httpStatus, 403);
});

test("web-search template records every failed attempt when all providers fail", async () => {
  const result = normalizeServiceHandlerResult(
    await webSearchServiceHandler({
      runtime: runtimeWith(async () => {
        throw new Error("offline");
      }),
      locale: "zh-CN",
      failureCode,
      endpointCfg: SEARCH_ENDPOINT,
      serviceCfg: {},
      queryString: { search: "noobot" },
    }),
  );
  assert.equal(result.code, SERVICE_FAILURE_CODE.UPSTREAM_UNREACHABLE);
  assert.ok(result.output.attempts.every((attempt) => attempt.error === "offline"));
});

test("web-search template rejects body and missing search as invalid input", async () => {
  for (const input of [{ body: "x", queryString: { search: "a" } }, { queryString: {} }]) {
    const result = normalizeServiceHandlerResult(
      await webSearchServiceHandler({
        runtime: runtimeWith(async () => assert.fail("must not fetch")),
        locale: "en-US",
        failureCode,
        endpointCfg: SEARCH_ENDPOINT,
        serviceCfg: {},
        ...input,
      }),
    );
    assert.equal(result.code, SERVICE_FAILURE_CODE.INPUT_INVALID);
  }
});
