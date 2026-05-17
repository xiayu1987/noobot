import test from "node:test";
import assert from "node:assert/strict";
import { ToolMessage } from "@langchain/core/messages";

import { buildContextMessages } from "../../../../src/system-core/agent/core/context/message-builder.js";

test("buildContextMessages drops orphan tool results without matching assistant tool_call", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {},
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_ok_1",
                  function: {
                    name: "task_summary",
                    arguments: "{}",
                  },
                },
              ],
            },
            {
              role: "tool",
              content: "{\"ok\":true}",
              tool_call_id: "call_ok_1",
            },
            {
              role: "tool",
              content: "{\"ok\":true}",
              tool_call_id: "call_orphan_1",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  const toolMessages = messages.filter((item) => item instanceof ToolMessage);
  assert.equal(toolMessages.length, 1);
  assert.equal(toolMessages[0].tool_call_id, "call_ok_1");
});
