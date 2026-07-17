/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAgentCollabTool } from "../../../src/system-core/tools/collaboration/agent-collab-tool.js";

function parseToolJson(text = "") {
  return JSON.parse(String(text || "{}"));
}

test("wait_async_task_result treats invalid_request container as failed summary", async () => {
  const agentContext = {
    userId: "primary-user",
    runtime: {
      userId: "primary-user",
      botManager: {
        waitAsyncSession: async () => ({ ok: true, status: "completed", result: {} }),
      },
      systemRuntime: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        dialogProcessId: "dp_1",
      },
      childAsyncResultContainers: [
        {
          id: "c1",
          parentSessionId: "",
          tasks: [],
        },
      ],
      globalConfig: {},
      userConfig: {},
      sharedTools: {},
    },
  };

  const tools = createAgentCollabTool({ agentContext });
  const waitTool = tools.find((item) => item?.name === "wait_async_task_result");
  assert.ok(waitTool);

  const raw = await waitTool.invoke({});
  const payload = parseToolJson(raw);

  assert.equal(payload.toolName, "wait_async_task_result");
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "failed");
});

