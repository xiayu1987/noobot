import test from "node:test";
import assert from "node:assert/strict";

import {
  filterSummarizedMessages,
  normalizeContextWindow,
  normalizeRecentWindow,
} from "../../../system-core/session/context-window-normalizer.js";

test("filterSummarizedMessages removes summarized messages", () => {
  const input = [
    { role: "user", content: "a", summarized: false },
    { role: "assistant", content: "b", summarized: true },
    { role: "tool", content: "c" },
  ];
  const result = filterSummarizedMessages(input);
  assert.deepEqual(result.map((item) => item.content), ["a", "c"]);
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
