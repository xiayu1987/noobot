/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { applyTurnCompletionPolicy } from "../src/policy/turn-completion.js";

test("turn completion marks eligible model messages and canonical store", () => {
  const messages = [
    {
      messageUid: "call-1",
      role: "assistant",
      tool_calls: [{ id: "tool-1", name: "read_file" }],
      summarized: false,
    },
    {
      messageUid: "result-1",
      role: "tool",
      tool_call_id: "tool-1",
      toolName: "read_file",
      content: "completed answer",
      summarized: false,
    },
  ];
  const store = {
    toArray: () => messages,
    updateWhere(patch, matcher) {
      let count = 0;
      messages.forEach((message, index) => {
        if (!matcher(message, index)) return;
        Object.assign(message, patch);
        count += 1;
      });
      return count;
    },
  };

  const result = applyTurnCompletionPolicy({ modelMessages: messages, turnMessageStore: store });

  assert.equal(result.markedCount, 2);
  assert.deepEqual(
    result.messages.map((message) => message.summarized),
    [true, true],
  );
});

test("turn completion requires the canonical store", () => {
  assert.throws(
    () => applyTurnCompletionPolicy({ modelMessages: [] }),
    /canonical turn message store/,
  );
});

test("turn completion mirrors the canonical UID decisions to a separate model snapshot", () => {
  const storeMessages = [
    {
      messageUid: "call-1",
      role: "assistant",
      tool_calls: [{ id: "tool-1", name: "read_file" }],
      summarized: false,
    },
    {
      messageUid: "result-1",
      role: "tool",
      tool_call_id: "tool-1",
      toolName: "read_file",
      content: "canonical",
      summarized: false,
    },
  ];
  const modelMessages = [
    {
      messageUid: "call-1",
      role: "assistant",
      tool_calls: [{ id: "tool-1", name: "read_file" }],
      content: "provider snapshot",
      summarized: false,
      lc_kwargs: {},
    },
    {
      messageUid: "result-1",
      role: "tool",
      tool_call_id: "tool-1",
      toolName: "read_file",
      content: "provider snapshot",
      summarized: false,
      lc_kwargs: {},
    },
  ];
  const store = {
    toArray: () => storeMessages,
    updateWhere(patch, matcher) {
      let count = 0;
      storeMessages.forEach((message, index) => {
        if (!matcher(message, index)) return;
        Object.assign(message, patch);
        count += 1;
      });
      return count;
    },
  };

  const result = applyTurnCompletionPolicy({ modelMessages, turnMessageStore: store });

  assert.equal(result.markedCount, 2);
  assert.deepEqual(
    modelMessages.map((message) => message.summarized),
    [true, true],
  );
  assert.deepEqual(
    modelMessages.map((message) => message.lc_kwargs.summarized),
    [true, true],
  );
});
