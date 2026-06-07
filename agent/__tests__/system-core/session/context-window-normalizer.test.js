import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSummarizedMessages,
  normalizeContextWindow,
  normalizeRecentWindow,
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
