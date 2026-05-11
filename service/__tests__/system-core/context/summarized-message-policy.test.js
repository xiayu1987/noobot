import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "../../../system-core/context/summarized-message-policy.js";

test("task_summary assistant tool_call is kept with its tool result", () => {
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

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(assistantMessage), false);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(toolMessage), false);
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

test("LangChain AIMessage-like task_summary tool_call is kept", () => {
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

  assert.equal(shouldMarkCurrentTurnSummarizedModelMessage(aiMessage), false);
});
