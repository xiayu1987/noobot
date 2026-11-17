/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { applyTurnCompletionPolicy } from "../src/policy/turn-completion.js";

function selectedTools(messages) {
  return {
    markedCount: messages.length,
    markedMessageUids: new Set(messages.map((message) => message.messageUid)),
    pendingMessageUids: messages
      .filter((message) => !message.summarized)
      .map((message) => message.messageUid),
  };
}

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
    readCompletionSelection: () => selectedTools(messages),
    toArray: () => assert.fail("completion must not expand the store"),
    updateByUid(uid, patch) {
      return Object.assign(
        messages.find((message) => message.messageUid === uid),
        patch,
      );
    },
  };

  const result = applyTurnCompletionPolicy({ modelMessages: [], turnMessageStore: store });

  assert.equal(result.markedCount, 2);
  assert.deepEqual(
    messages.map((message) => message.summarized),
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
      role: "assistant",
      tool_calls: [{ id: "tool-1", name: "read_file" }],
      content: "provider snapshot",
      additional_kwargs: { messageUid: "call-1", summarized: false },
    },
    {
      role: "tool",
      tool_call_id: "tool-1",
      content: "provider snapshot",
      additional_kwargs: { messageUid: "result-1", toolName: "read_file", summarized: false },
    },
  ];
  const store = {
    readCompletionSelection: () => selectedTools(storeMessages),
    toArray: () => assert.fail("completion must not expand the store"),
    updateByUid(uid, patch) {
      return Object.assign(
        storeMessages.find((message) => message.messageUid === uid),
        patch,
      );
    },
  };

  const result = applyTurnCompletionPolicy({ modelMessages, turnMessageStore: store });

  assert.equal(result.markedCount, 2);
  assert.deepEqual(
    modelMessages.map((message) => message.additional_kwargs.summarized),
    [true, true],
  );
  assert.deepEqual(
    storeMessages.map((message) => message.summarized),
    [true, true],
  );
});

test("turn completion mirrors existing summary marks without rewriting their durable revisions", () => {
  const batch = (key, summarized) => [
    {
      messageUid: `${key}-call`,
      role: "assistant",
      tool_calls: [{ id: key, name: "read_file" }],
      summarized,
    },
    {
      messageUid: `${key}-result`,
      role: "tool",
      tool_call_id: key,
      toolName: "read_file",
      content: "completed",
      summarized,
    },
  ];
  const messages = Array.from({ length: 512 }, (_, index) =>
    batch(`committed-${index}`, true),
  ).flat();
  messages.push(...batch("tail", false));
  const updates = [];
  const modelMessages = [
    {
      role: "assistant",
      content: "committed",
      additional_kwargs: { messageUid: "committed-0-call", summarized: false },
    },
  ];
  const store = {
    readCompletionSelection: () => selectedTools(messages),
    toArray: () => assert.fail("completion must not expand the store"),
    updateWhere: () => assert.fail("bulk store reconstruction is forbidden"),
    updateByUid(uid, patch) {
      updates.push(uid);
      return Object.assign(
        messages.find((message) => message.messageUid === uid),
        patch,
      );
    },
  };
  assert.equal(
    applyTurnCompletionPolicy({ modelMessages, turnMessageStore: store }).markedCount,
    1026,
  );
  assert.deepEqual(updates, ["tail-call", "tail-result"]);
  assert.equal(modelMessages[0].additional_kwargs.summarized, true);
  updates.length = 0;
  applyTurnCompletionPolicy({ modelMessages, turnMessageStore: store });
  assert.deepEqual(updates, []);
});
