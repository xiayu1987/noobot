/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { createRequestHelpTool } from "../../../src/system-core/tools/collaboration/request-help-tool.js";
import { resetModelAdapter, setModelAdapter } from "../../../src/system-core/model/index.js";

afterEach(() => {
  resetModelAdapter();
});

test("request_help: model invoke receives runtime abort signal", async () => {
  const abortController = new AbortController();
  let receivedOptions;
  setModelAdapter({
    resolveDefaultModelSpec: () => ({ alias: "fake", model: "fake-model" }),
    resolveModelSpecByName: () => null,
    createChatModelByName: () => ({
      invoke: async (_messages, options) => {
        receivedOptions = options;
        return { content: "help response" };
      },
    }),
    createChatModel: () => ({
      invoke: async (_messages, options) => {
        receivedOptions = options;
        return { content: "help response" };
      },
    }),
  });

  const runtime = {
    abortSignal: abortController.signal,
    globalConfig: {},
    userConfig: {},
    systemRuntime: {},
  };
  const [tool] = createRequestHelpTool({ agentContext: { runtime } });

  const result = await tool.invoke({
    helpContent: "Need help with a long task",
    requestType: "model_help",
  });
  const parsed = JSON.parse(result);

  assert.equal(receivedOptions?.signal, abortController.signal);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.modelResult?.content, "help response");
});
