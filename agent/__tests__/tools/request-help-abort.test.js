/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createRequestHelpTool } from "../../src/tools/collaboration/request-help-tool.js";

test("request_help: model invoke receives runtime abort signal", async () => {
  const abortController = new AbortController();
  let receivedRequest;

  const runtime = {
    abortSignal: abortController.signal,
    locale: "en-US",
    globalConfig: {
      defaultProvider: "fake",
      providers: {
        fake: {
          alias: "fake",
          model: "fake-model",
          format: "openai_compatible",
          providerId: "fake",
          adapterId: "openai-compatible",
        },
      },
    },
    userConfig: {},
    systemRuntime: {},
    modelPort: {
      invoke: async (request) => {
        receivedRequest = request;
        return { output: { text: "help response" }, text: "help response" };
      },
    },
  };
  const [tool] = createRequestHelpTool({ agentContext: { bindings: { runtime } } });

  const result = await tool.invoke({
    helpContent: "Need help with a long task",
    requestType: "model_help",
  });
  const parsed = JSON.parse(result);

  assert.equal(receivedRequest?.options?.signal, abortController.signal);
  assert.equal(receivedRequest?.model?.model, "fake-model");
  assert.equal(receivedRequest?.model?.format, "openai_compatible");
  assert.equal(receivedRequest?.messages?.[0]?.role, "system");
  assert.match(receivedRequest?.messages?.[0]?.content, /independent assistance model/i);
  assert.deepEqual(receivedRequest?.messages?.slice(1), [
    { role: "user", content: "Need help with a long task" },
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.modelResult?.content, "help response");
});

test("request_help: web_search_help reports unavailable search configuration", async () => {
  const runtime = {
    globalConfig: { tools: { request_help: { help_services: [] } } },
    userConfig: {},
    locale: "en-US",
  };
  const [tool] = createRequestHelpTool({ agentContext: { bindings: { runtime } } });

  await assert.rejects(
    tool.invoke({ helpContent: "Find current documentation", requestType: "web_search_help" }),
    (error) => {
      assert.equal(error?.code, "RECOVERABLE_REQUEST_HELP_FAILED");
      assert.match(String(error?.message || ""), /web-search help is unavailable/i);
      assert.equal(String(error?.message || "").includes("required"), false);
      return true;
    },
  );
});
