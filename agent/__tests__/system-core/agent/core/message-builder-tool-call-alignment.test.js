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

test("buildContextMessages filters injected messages from non-current dialog", () => {
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            systemRuntime: {
              dialogProcessId: "dlg_current",
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history: [
            {
              role: "assistant",
              content: "当前对话注入",
              injectedMessage: true,
              injectedBy: "harness-plugin",
              dialogProcessId: "dlg_current",
            },
            {
              role: "assistant",
              content: "旧对话注入",
              injectedMessage: true,
              injectedBy: "harness-plugin",
              dialogProcessId: "dlg_old",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "当前对话注入");
});

test("buildContextMessages applies main model recent window by default", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: "assistant",
    content: `m-${index + 1}`,
  }));
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
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.length, 15);
  assert.equal(messages[0]?.content, "m-6");
  assert.equal(messages[messages.length - 1]?.content, "m-20");
});

test("buildContextMessages can disable main model recent window via context config", () => {
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: "assistant",
    content: `m-${index + 1}`,
  }));
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            globalConfig: {
              context: {
                mainModelRecentWindow: false,
                mainModelRecentLimit: 15,
              },
            },
          },
        },
      },
      payload: {
        messages: {
          system: [],
          history,
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.length, 20);
  assert.equal(messages[0]?.content, "m-1");
  assert.equal(messages[messages.length - 1]?.content, "m-20");
});
