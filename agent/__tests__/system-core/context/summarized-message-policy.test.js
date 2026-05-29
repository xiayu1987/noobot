import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSummarizedMessages,
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "../../../src/system-core/context/session/summarized-message-policy.js";

test("task_summary assistant tool_call and tool result are marked summarized", () => {
  const assistantMessage = {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary",
        type: "function",
        function: {
          name: "task_summary",
          arguments: "{}",
        },
      },
    ],
  };
  const toolMessage = {
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", ok: true }),
    tool_call_id: "call_task_summary",
    toolName: "task_summary",
  };

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(assistantMessage), true);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(toolMessage), true);
});

test("non-summary empty assistant tool_call can be summarized with its tool result", () => {
  const assistantMessage = {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_execute",
        type: "function",
        function: {
          name: "execute_script",
          arguments: "{}",
        },
      },
    ],
  };
  const toolMessage = {
    role: "tool",
    content: JSON.stringify({ toolName: "execute_script", ok: true }),
    tool_call_id: "call_execute",
    toolName: "execute_script",
  };

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(assistantMessage), true);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(toolMessage), true);
});

test("LangChain AIMessage-like task_summary tool_call is marked summarized", () => {
  const aiMessage = {
    type: "ai",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary",
        name: "task_summary",
        args: {},
        type: "tool_call",
      },
    ],
  };

  assert.equal(shouldMarkCurrentTurnSummarizedModelMessage(aiMessage), true);
});

test("filterSummarizedMessages excludes only summarized in one policy", () => {
  const input = [
    { role: "user", content: "keep me" },
    { role: "assistant", content: "old", summarized: true },
    { role: "assistant", content: "call", tool_calls: [{ id: "c1", function: { name: "x" } }] },
    { role: "tool", content: "{\"ok\":true}", tool_call_id: "c1" },
    { role: "assistant", content: "keep too" },
  ];
  const result = filterSummarizedMessages(input);
  assert.deepEqual(result.map((item) => item.content), [
    "keep me",
    "call",
    "{\"ok\":true}",
    "keep too",
  ]);
});

test("filterSummarizedMessages keeps summarized current system context marker", () => {
  const input = [
    { role: "system", content: "old system", summarized: true },
    {
      role: "system",
      content: "current system context",
      summarized: true,
      additional_kwargs: {
        noobotInternalMessageType: "system_context",
      },
    },
    { role: "user", content: "task" },
  ];
  const result = filterSummarizedMessages(input);
  assert.deepEqual(result.map((item) => item.content), [
    "current system context",
    "task",
  ]);
});

test("system is summarized while user and assistant-without-tool-calls are not", () => {
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage({ role: "system", content: "note" }),
    true,
  );
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage({ role: "user", content: "ask" }),
    false,
  );
  assert.equal(
    shouldMarkCurrentTurnSummarizedMessage({ role: "assistant", content: "plain text" }),
    false,
  );
});
