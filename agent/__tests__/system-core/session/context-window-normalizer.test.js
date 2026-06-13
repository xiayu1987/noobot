import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSummarizedMessages,
  normalizeContextWindow,
  normalizeRecentWindow,
  resolveMainModelFinalMessages,
  resolveMainModelHistoryMessages,
  resolveMainModelIncrementalMessages,
  resolveModelContextMessages,
} from "../../../src/system-core/session/utils/context-window-normalizer.js";
import { markCurrentTurnArraySummarized } from "../../../src/system-core/context/session/summarized-message-policy.js";

test("filterSummarizedMessages removes only summarized messages", () => {
  const input = [
    { role: "user", content: "a", summarized: false },
    { role: "assistant", content: "b", summarized: true },
    { role: "tool", content: "c" },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "x" } }] },
  ];
  const result = filterSummarizedMessages(input);
  assert.deepEqual(result.map((item) => item.content), ["a"]);
});


test("task_summary pair is not marked summarized and remains in model context", () => {
  const messages = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_exec", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_exec",
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"阶段小结内容\"}",
      tool_call_id: "call_summary",
    },
  ];

  const marked = markCurrentTurnArraySummarized(messages);
  assert.equal(marked[1]?.summarized, true);
  assert.equal(marked[2]?.summarized, true);
  assert.equal(marked[3]?.summarized, undefined);
  assert.equal(marked[4]?.summarized, undefined);

  const result = filterSummarizedMessages(marked);
  assert.deepEqual(
    result.map((item) => String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0", "call_summary", "call_summary"],
  );
  assert.equal(result[2]?.content.includes("阶段小结内容"), true);
});


test("manually summarized task_summary pair is filtered by unified summarized policy", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      summarized: true,
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      summarized: true,
      content: "{\"toolName\":\"task_summary\",\"ok\":true,\"phaseSummary\":\"历史阶段小结\"}",
      tool_call_id: "call_summary",
    },
    { role: "assistant", content: "old normal", summarized: true },
  ];

  const result = filterSummarizedMessages(input);
  assert.deepEqual(
    result.map((item) => String(item?.tool_call_id || item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0"],
  );
});


test("unpaired task_summary assistant tool call is dropped to avoid invalid model messages", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_summary", function: { name: "task_summary", arguments: "{}" } }],
    },
  ];

  const result = filterSummarizedMessages(input);
  assert.deepEqual(
    result.map((item) => String(item?.tool_calls?.[0]?.id || item?.content || "")),
    ["u0"],
  );
});

test("normalizeContextWindow drops orphan tool result and keeps valid pair", () => {
  const input = [
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_1",
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_orphan",
    },
  ];
  const result = normalizeContextWindow({ sourceMessages: input, startIndex: 0 });
  assert.equal(result.length, 2);
  assert.equal(
    result.some((item) => String(item?.tool_call_id || "") === "call_orphan"),
    false,
  );
});

test("normalizeRecentWindow prepends a user anchor when sliced window has no user", () => {
  const input = [
    { role: "user", content: "anchor user" },
    { role: "assistant", content: "a" },
    { role: "assistant", content: "b" },
  ];
  const result = normalizeRecentWindow(input, 2);
  assert.equal(result[0]?.role, "user");
});

test("normalizeContextWindow prepends previous user when clipped window starts with assistant", () => {
  const input = [
    { role: "user", content: "u0" },
    { role: "assistant", content: "a0" },
    { role: "assistant", content: "a1" },
  ];
  const result = normalizeContextWindow({
    sourceMessages: input,
    startIndex: 1,
    limit: 2,
  });
  assert.deepEqual(
    result.map((item) => `${item.role}:${item.content}`),
    ["user:u0", "assistant:a1"],
  );
});

test("normalizeRecentWindow keeps latest assistant-tool pair after truncation", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", function: { name: "execute_script", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"execute_script\",\"ok\":true}",
      tool_call_id: "call_1",
    },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_2", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      tool_call_id: "call_2",
    },
  ];
  const result = normalizeRecentWindow(input, 3);
  assert.deepEqual(
    result.map((item) => item.role),
    ["user", "assistant", "tool"],
  );
});

test("normalizeRecentWindow converts orphan task_summary tool to user after truncation shrink", () => {
  const input = [
    { role: "user", content: "u0" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_2", function: { name: "task_summary", arguments: "{}" } }],
    },
    {
      role: "tool",
      content: "{\"toolName\":\"task_summary\",\"ok\":true}",
      tool_call_id: "call_2",
    },
  ];
  const result = normalizeRecentWindow(input, 2);
  assert.deepEqual(
    result.map((item) => item.role),
    ["user", "user"],
  );
  assert.equal(result[1]?.phaseSummaryMemory, true);
  assert.equal(String(result[1]?.content || "").startsWith("[阶段小结]"), true);
});

test("resolveModelContextMessages filters injected messages by current dialog", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      { role: "assistant", content: "keep", injectedMessage: true, dialogProcessId: "d1" },
      { role: "assistant", content: "drop", injectedMessage: true, dialogProcessId: "d2" },
      { role: "assistant", content: "normal" },
    ],
    currentDialogProcessId: "d1",
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["keep", "normal"],
  );
});

test("resolveModelContextMessages filters injected user messages by current dialog", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      { role: "user", content: "keep", injectedBy: "harness-plugin", dialogProcessId: "d1" },
      { role: "user", content: "drop", injectedBy: "harness-plugin", dialogProcessId: "d2" },
      { role: "user", content: "normal user" },
    ],
    currentDialogProcessId: "d1",
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["keep", "normal user"],
  );
});

test("resolveModelContextMessages treats harness relay message as injected and filters by dialog", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\nold",
        dialogProcessId: "d_old",
      },
      {
        role: "user",
        content: "[来自harness外部模型输出/planning]\nnew",
        dialogProcessId: "d_new",
      },
      { role: "user", content: "normal user" },
    ],
    currentDialogProcessId: "d_new",
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["[来自harness外部模型输出/planning]\nnew", "normal user"],
  );
});

test("resolveModelContextMessages supports recent window clipping", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      { role: "user", content: "u0" },
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
    ],
    useRecentWindow: true,
    recentLimit: 2,
  });
  assert.deepEqual(
    result.map((item) => item.role),
    ["user", "assistant"],
  );
});

test("resolveModelContextMessages supports harness mode with normalize/filter pipeline", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      { role: "assistant", content: "a0", injectedMessage: true, dialogProcessId: "d1" },
      { role: "assistant", content: "drop-by-dialog", injectedMessage: true, dialogProcessId: "d2" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "a1" },
      { role: "assistant", content: "a2" },
    ],
    currentDialogProcessId: "d1",
    mode: "harness",
    recentLimit: 2,
    normalizeMessage: (item = {}) => ({
      role: String(item?.role || "").trim().toLowerCase(),
      content: String(item?.content || "").trim(),
    }),
    shouldKeepMessage: (item = {}) => String(item?.content || "").trim(),
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["a1", "a2"],
  );
});


test("resolveModelContextMessages keeps latest injected message per type after dialog filtering", () => {
  const result = resolveModelContextMessages({
    sourceMessages: [
      { role: "user", content: "old summary", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance_summary_prompt", dialogProcessId: "d1" },
      { role: "user", content: "planning", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "planning_task", dialogProcessId: "d1" },
      { role: "user", content: "new summary", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance_summary_prompt", dialogProcessId: "d1" },
      { role: "user", content: "other dialog newest", injectedMessage: true, injectedBy: "harness-plugin", injectedMessageType: "guidance_summary_prompt", dialogProcessId: "d2" },
      { role: "assistant", content: "normal" },
    ],
    currentDialogProcessId: "d1",
  });
  assert.deepEqual(
    result.map((item) => item.content),
    ["planning", "new summary", "normal"],
  );
});


test("resolveMainModelHistoryMessages keeps first actual user and latest assistant per dialog then clips to 10", () => {
  const input = Array.from({ length: 6 }, (_, index) => {
    const dialogProcessId = `d${index + 1}`;
    return [
      { role: "user", content: `u${index + 1}-first`, dialogProcessId },
      { role: "user", content: `u${index + 1}-second`, dialogProcessId },
      { role: "assistant", content: `a${index + 1}-old`, dialogProcessId },
      { role: "assistant", content: `a${index + 1}-latest`, dialogProcessId },
    ];
  }).flat();

  const result = resolveMainModelHistoryMessages({ sourceMessages: input });

  assert.deepEqual(
    result.map((item) => item.content),
    [
      "u2-first",
      "a2-latest",
      "u3-first",
      "a3-latest",
      "u4-first",
      "a4-latest",
      "u5-first",
      "a5-latest",
      "u6-first",
      "a6-latest",
    ],
  );
});

test("resolveMainModelHistoryMessages excludes injected and user meta from actual user selection", () => {
  const result = resolveMainModelHistoryMessages({
    sourceMessages: [
      { role: "user", content: "injected", injectedBy: "harness-plugin", dialogProcessId: "d1" },
      { role: "user", content: "meta", additional_kwargs: { noobotInternalMessageType: "user_meta" }, dialogProcessId: "d1" },
      { role: "user", content: "actual", dialogProcessId: "d1" },
      { role: "assistant", content: "old", dialogProcessId: "d1" },
      { role: "assistant", content: "latest", dialogProcessId: "d1" },
    ],
  });

  assert.deepEqual(result.map((item) => item.content), ["actual", "latest"]);
});

test("resolveMainModelIncrementalMessages filters summarized messages without clipping", () => {
  const result = resolveMainModelIncrementalMessages({
    sourceMessages: Array.from({ length: 22 }, (_, index) => ({
      role: "user",
      content: `m${index + 1}`,
      summarized: index === 5,
    })),
  });

  assert.equal(result.length, 21);
  assert.equal(result[0].content, "m1");
  assert.equal(result.at(-1).content, "m22");
  assert.equal(result.some((item) => item.content === "m6"), false);
});

test("resolveMainModelFinalMessages composes system history incremental in order", () => {
  const result = resolveMainModelFinalMessages({
    systemMessages: [{ role: "system", content: "sys" }],
    historyMessages: [
      { role: "user", content: "u", dialogProcessId: "d1" },
      { role: "assistant", content: "a", dialogProcessId: "d1" },
    ],
    incrementalMessages: [{ role: "user", content: "inc" }],
  });

  assert.deepEqual(result.messages.map((item) => item.content), ["sys", "u", "a", "inc"]);
});

test("main-flow context resolution does not mutate source message order or count when unsummarized", () => {
  const systemMessages = [{ role: "system", content: "sys-1" }];
  const historyMessages = [
    { role: "user", content: "u1", dialogProcessId: "d1" },
    { role: "assistant", content: "a1", dialogProcessId: "d1" },
    { role: "user", content: "u2", dialogProcessId: "d2" },
    { role: "assistant", content: "a2", dialogProcessId: "d2" },
  ];
  const incrementalMessages = [
    { role: "user", content: "current", dialogProcessId: "d3" },
    { role: "assistant", content: "current-a", dialogProcessId: "d3" },
  ];
  const before = JSON.stringify({ systemMessages, historyMessages, incrementalMessages });

  const resolved = resolveMainModelFinalMessages({
    systemMessages,
    historyMessages,
    incrementalMessages,
    currentDialogProcessId: "d3",
  });

  assert.deepEqual(
    resolved.messages.map((item) => item.content),
    ["sys-1", "u1", "a1", "u2", "a2", "current", "current-a"],
  );
  assert.equal(JSON.stringify({ systemMessages, historyMessages, incrementalMessages }), before);
  assert.deepEqual(historyMessages.map((item) => item.content), ["u1", "a1", "u2", "a2"]);
  assert.equal(historyMessages.length, 4);
  assert.deepEqual(incrementalMessages.map((item) => item.content), ["current", "current-a"]);
  assert.equal(incrementalMessages.length, 2);
});

test("resolveMainModelIncrementalMessages preserves actual order for tool, plugin, and main-flow increments", () => {
  const incrementalMessages = [
    { role: "user", content: "main-user", dialogProcessId: "d1" },
    {
      role: "assistant",
      content: "",
      dialogProcessId: "d1",
      tool_calls: [{ id: "call-1", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", content: "tool-result", tool_call_id: "call-1", dialogProcessId: "d1" },
    {
      role: "user",
      content: "plugin-guidance",
      injectedMessage: true,
      injectedBy: "harness-plugin",
      injectedMessageType: "guidance",
      dialogProcessId: "d1",
    },
    {
      role: "system",
      content: "main-injected-system",
      injectedMessage: true,
      injectedBy: "main-flow",
      injectedMessageType: "runtime_hint",
      dialogProcessId: "d1",
    },
    { role: "assistant", content: "main-assistant", dialogProcessId: "d1" },
  ];

  const result = resolveMainModelIncrementalMessages({
    sourceMessages: incrementalMessages,
    currentDialogProcessId: "d1",
  });

  assert.deepEqual(
    result.map((item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id),
    ["main-user", "call-1", "tool-result", "plugin-guidance", "main-injected-system", "main-assistant"],
  );
  assert.deepEqual(
    incrementalMessages.map((item = {}) => item.content || item.tool_call_id || item.tool_calls?.[0]?.id),
    ["main-user", "call-1", "tool-result", "plugin-guidance", "main-injected-system", "main-assistant"],
  );
});
