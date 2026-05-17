import test from "node:test";
import assert from "node:assert/strict";

import { createUserInteractionTool } from "../../../src/system-core/tools/workflow/user-interaction-tool.js";

function parseToolJson(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

test("user_interaction: should forward lifecycle/ackMode defaults to bridge", async () => {
  const calls = [];
  const tools = createUserInteractionTool({
    agentContext: {
      runtime: {
        userInteractionBridge: {
          async requestUserInteraction(payload = {}) {
            calls.push(payload);
            return {
              confirmTest: "yes",
              response: "ok",
            };
          },
        },
        systemRuntime: {
          dialogProcessId: "dp-1",
          sessionId: "s-1",
        },
      },
    },
  });

  const tool = tools.find((item) => item?.name === "user_interaction");
  assert.ok(tool, "user_interaction tool should exist");

  const result = parseToolJson(
    await tool.invoke({
      content: "please confirm",
      fields: {
        fields: [
          {
            name: "confirmTest",
            displayName: "确认",
            required: true,
            description: "",
          },
        ],
      },
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0]?.lifecycle || ""), "pending");
  assert.equal(String(calls[0]?.ackMode || ""), "manual");
  assert.equal(String(calls[0]?.resolvedBy || ""), "");
});

