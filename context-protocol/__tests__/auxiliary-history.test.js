/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { projectAuxiliaryHistoryMessages } from "../src/assembly/auxiliary-history.js";

test("auxiliary history projects tool evidence into the observer perspective", () => {
  const messages = projectAuxiliaryHistoryMessages([
    { role: "user", content: "run it" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"filePath":"a.txt"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call-1", content: '{"ok":true}' },
  ]);
  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "user", "assistant"],
  );
  assert.match(messages[1].content, /read_file/);
  assert.equal(messages[2].content, '{"ok":true}');
});

test("auxiliary history rejects tool results without their authoritative call", () => {
  assert.throws(
    () =>
      projectAuxiliaryHistoryMessages([
        { role: "tool", tool_call_id: "orphan", content: '{"ok":true}' },
      ]),
    /orphan auxiliary tool result: orphan/,
  );
});

test("auxiliary history keeps a pending tool call without inventing a result", () => {
  const messages = projectAuxiliaryHistoryMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "pending", type: "function", function: { name: "search", arguments: "{}" } },
      ],
    },
  ]);
  assert.equal(messages.length, 1);
  assert.match(messages[0].content, /search/);
});
