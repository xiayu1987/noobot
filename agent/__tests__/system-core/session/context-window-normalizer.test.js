import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSummarizedMessages,
  normalizeContextWindow,
  normalizeRecentWindow,
  resolveModelContextMessages,
} from "../../../src/system-core/session/utils/context-window-normalizer.js";

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

test("normalizeRecentWindow should not leave orphan tool after truncation shrink", () => {
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
    ["user"],
  );
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
