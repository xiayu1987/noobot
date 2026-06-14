import test from "node:test";
import assert from "node:assert/strict";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";

import {
  buildContextMessages,
  buildContextMessageBlocks,
} from "../../../../src/system-core/agent/core/context/message-builder.js";

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


test("buildContextMessages converts orphan task_summary tool result to user summary message", () => {
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
              role: "tool",
              content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"孤立小结内容\"}",
              tool_call_id: "call_orphan_summary",
            },
          ],
        },
      },
    },
    { currentUserMessage: "" },
  );

  assert.equal(messages.some((item) => item instanceof ToolMessage), false);
  const humanMessage = messages.find((item) => item instanceof HumanMessage);
  assert.ok(humanMessage);
  assert.equal(String(humanMessage.content || "").includes("[阶段小结]"), true);
  assert.equal(String(humanMessage.content || "").includes("孤立小结内容"), true);
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
              injectedBy: "agent-plugin",
              dialogProcessId: "dlg_current",
            },
            {
              role: "assistant",
              content: "旧对话注入",
              injectedMessage: true,
              injectedBy: "agent-plugin",
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

test("buildContextMessages uses plugin history recent limit when harness plugin is enabled", () => {
  const history = Array.from({ length: 30 }, (_, index) => ({
    role: "assistant",
    content: `m-${index + 1}`,
  }));
  const messages = buildContextMessages(
    {
      execution: {
        controllers: {
          runtime: {
            globalConfig: {
              plugins: {
                harness: {
                  enabled: true,
                  mode: "on",
                  contextWindowRecentMessageLimit: 20,
                },
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
  assert.equal(messages[0]?.content, "m-11");
  assert.equal(messages[messages.length - 1]?.content, "m-30");
});

test("buildContextMessageBlocks splits system/history/incremental and preserves concat order", () => {
  const blocks = buildContextMessageBlocks(
    {
      execution: {
        controllers: {
          runtime: {
            userId: "u1",
            systemRuntime: {
              sessionId: "s1",
              dialogProcessId: "dlg1",
            },
          },
        },
      },
      payload: {
        messages: {
          system: ["sys-1"],
          history: [{ role: "assistant", content: "h-1" }],
        },
      },
    },
    { currentUserMessage: "u-1" },
  );

  assert.equal(Array.isArray(blocks.system), true);
  assert.equal(Array.isArray(blocks.history), true);
  assert.equal(Array.isArray(blocks.incremental), true);
  assert.equal(blocks.system.length, 1);
  assert.equal(blocks.history.length, 1);
  assert.equal(blocks.incremental.length, 2);
  assert.equal(blocks.messages.length, 4);
  assert.equal(blocks.messages[0]?.content, "sys-1");
  assert.equal(blocks.messages[1]?.content, "h-1");
  assert.equal(blocks.messages[2]?.content, "u-1");
});
