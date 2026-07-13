import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSummarizedMessages,
  markCurrentTurnArraySummarized,
  markCurrentTurnModelMessagesSummarized,
  markCurrentTurnStoreSummarized,
  shouldMarkCurrentTurnSummarizedMessage,
  shouldMarkCurrentTurnSummarizedModelMessage,
} from "../../../src/system-core/context/session/summarized-message-policy.js";
import { createCurrentTurnMessagesStore } from "../../../src/system-core/context/session/current-turn-store.js";

test("markCurrentTurnArraySummarized preserves only latest task_summary call and result", () => {
  const oldAssistantMessage = {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary_old",
        type: "function",
        function: {
          name: "task_summary",
          arguments: "{}",
        },
      },
    ],
  };
  const oldToolMessage = {
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", ok: true }),
    tool_call_id: "call_task_summary_old",
    toolName: "task_summary",
  };
  const latestAssistantMessage = {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_task_summary_latest",
        type: "function",
        function: {
          name: "task_summary",
          arguments: "{}",
        },
      },
    ],
  };
  const latestToolMessage = {
    role: "tool",
    content: JSON.stringify({ toolName: "task_summary", ok: true }),
    tool_call_id: "call_task_summary_latest",
    toolName: "task_summary",
  };

  assert.equal(shouldMarkCurrentTurnSummarizedMessage(oldAssistantMessage), false);
  assert.equal(shouldMarkCurrentTurnSummarizedMessage(oldToolMessage), false);

  const result = markCurrentTurnArraySummarized([
    oldAssistantMessage,
    oldToolMessage,
    { role: "user", content: "next task" },
    latestAssistantMessage,
    latestToolMessage,
  ]);

  assert.equal(result[0].summarized, true);
  assert.equal(result[1].summarized, true);
  assert.equal(result[2].summarized, undefined);
  assert.equal(result[3].summarized, undefined);
  assert.equal(result[4].summarized, undefined);
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

test("summarization includes every restored incremental tool call and result without duplication", () => {
  const restoredIncremental = [
    {
      type: "ai",
      content: "",
      tool_calls: [{ id: "call_search", name: "search", args: {}, type: "tool_call" }],
      lc_kwargs: {},
    },
    {
      type: "tool",
      content: "search-result",
      tool_call_id: "call_search",
      toolName: "search",
      lc_kwargs: {},
    },
    {
      type: "ai",
      content: "",
      tool_calls: [{ id: "call_read", name: "read_file", args: {}, type: "tool_call" }],
      lc_kwargs: {},
    },
    {
      type: "tool",
      content: "read-result",
      tool_call_id: "call_read",
      toolName: "read_file",
      lc_kwargs: {},
    },
  ];
  const latestSummaryCall = {
    type: "ai",
    content: "",
    tool_calls: [{ id: "call_summary", name: "task_summary", args: {}, type: "tool_call" }],
    lc_kwargs: {},
  };
  const messages = [
    { type: "human", content: "restored task", lc_kwargs: {} },
    ...restoredIncremental,
    latestSummaryCall,
  ];

  markCurrentTurnModelMessagesSummarized(messages);

  assert.equal(messages.length, 6);
  assert.deepEqual(
    messages.slice(1, 5).map((message) => message.tool_call_id || message.tool_calls?.[0]?.id),
    ["call_search", "call_search", "call_read", "call_read"],
  );
  assert.ok(messages.slice(1, 5).every((message) => message.summarized === true));
  assert.ok(messages.slice(1, 5).every((message) => message.lc_kwargs.summarized === true));
  assert.equal(latestSummaryCall.summarized, undefined);
});

test("LangChain AIMessage-like task_summary tool_call is not marked summarized", () => {
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

test("markCurrentTurnModelMessagesSummarized preserves only latest LangChain task_summary message", () => {
  const messages = [
    {
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call_task_summary_old",
          name: "task_summary",
          args: {},
          type: "tool_call",
        },
      ],
      lc_kwargs: {},
    },
    {
      type: "tool",
      content: JSON.stringify({ toolName: "task_summary", ok: true }),
      tool_call_id: "call_task_summary_old",
      toolName: "task_summary",
      lc_kwargs: {},
    },
    {
      type: "ai",
      content: "",
      tool_calls: [
        {
          id: "call_task_summary_latest",
          name: "task_summary",
          args: {},
          type: "tool_call",
        },
      ],
      lc_kwargs: {},
    },
  ];

  markCurrentTurnModelMessagesSummarized(messages);

  assert.equal(messages[0].summarized, true);
  assert.equal(messages[0].lc_kwargs.summarized, true);
  assert.equal(messages[1].summarized, true);
  assert.equal(messages[1].lc_kwargs.summarized, true);
  assert.equal(messages[2].summarized, undefined);
  assert.equal(messages[2].lc_kwargs.summarized, undefined);
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


test("markCurrentTurnArraySummarized preserves only latest injected message per type", () => {
  const result = markCurrentTurnArraySummarized([
    { role: "user", content: "old summary prompt", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance_summary_prompt" },
    { role: "user", content: "old planning prompt", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "planning_task" },
    { role: "user", content: "new summary prompt", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance_summary_prompt" },
  ]);

  assert.equal(result[0].summarized, true);
  assert.equal(result[1].summarized, undefined);
  assert.equal(result[2].summarized, undefined);
});

test("markCurrentTurnModelMessagesSummarized includes restored old injections and preserves latest per type", () => {
  const messages = [
    { type: "human", content: "old guidance", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance", lc_kwargs: {} },
    { type: "human", content: "planning", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "planning", lc_kwargs: {} },
    { type: "human", content: "new guidance", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance", lc_kwargs: {} },
    { type: "ai", content: "", tool_calls: [{ id: "call_summary", name: "task_summary", args: {}, type: "tool_call" }], lc_kwargs: {} },
  ];

  markCurrentTurnModelMessagesSummarized(messages);

  assert.equal(messages[0].summarized, true);
  assert.equal(messages[0].lc_kwargs.summarized, true);
  assert.equal(messages[1].summarized, undefined);
  assert.equal(messages[2].summarized, undefined);
  assert.equal(messages[3].summarized, undefined);
});

test("model and store projections apply one summarization scope policy", () => {
  const source = [
    { role: "user", content: "old guidance", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance", lc_kwargs: {} },
    { role: "assistant", content: "", tool_calls: [{ id: "call_search", function: { name: "search", arguments: "{}" } }], lc_kwargs: {} },
    { role: "tool", content: "search-result", tool_call_id: "call_search", toolName: "search", lc_kwargs: {} },
    { role: "user", content: "new guidance", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "guidance", lc_kwargs: {} },
    { role: "assistant", content: "", tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }], lc_kwargs: {} },
    { role: "tool", content: JSON.stringify({ toolName: "task_summary", ok: true }), tool_call_id: "call_summary", toolName: "task_summary", lc_kwargs: {} },
  ];
  const modelMessages = structuredClone(source);
  const store = createCurrentTurnMessagesStore(structuredClone(source));

  markCurrentTurnModelMessagesSummarized(modelMessages);
  markCurrentTurnStoreSummarized(store);

  assert.deepEqual(
    modelMessages.map((message) => message.summarized === true),
    store.toArray().map((message) => message.summarized === true),
  );
  assert.deepEqual(
    modelMessages.map((message) => message.summarized === true),
    [true, true, true, false, false, false],
  );
});

test("filterSummarizedMessages keeps latest injected message for each injected type", () => {
  const result = filterSummarizedMessages([
    { role: "user", content: "old relay", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "separate_model_relay:planning" },
    { role: "user", content: "planning prompt", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "planning_task" },
    { role: "user", content: "new relay", injectedMessage: true, injectedBy: "agent-plugin", injectedMessageType: "separate_model_relay:planning" },
    { role: "assistant", content: "normal" },
  ]);

  assert.deepEqual(result.map((item) => item.content), [
    "planning prompt",
    "new relay",
    "normal",
  ]);
});
