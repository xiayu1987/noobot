/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendMessage,
  markSummarized,
  replaceMessages,
  writeMessageBlocks,
} from "../src/core/message-store.js";

test("message store API appends messages and keeps block arrays synchronized", () => {
  const ctx = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  const message = appendMessage(ctx, { role: "user", content: "hello" }, { block: "incremental" });

  assert.equal(ctx.messages[0], message);
  assert.equal(ctx.messageBlocks.incremental[0], message);
  assert.ok(message.additional_kwargs.noobotMessageId);
  assert.equal(ctx.messageBlocks.incrementalIds, undefined);
});

test("message store API replaces messages and writes canonical block views", () => {
  const ctx = {};
  const toolCall = { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "write_file" } }] };
  const toolCopy = structuredClone(toolCall);

  replaceMessages(ctx, [{ role: "system", content: "sys" }, toolCall]);
  writeMessageBlocks(ctx, {
    system: [{ role: "system", content: "sys" }],
    history: [],
    incremental: [toolCopy],
  });

  assert.equal(ctx.messages[1], ctx.messageBlocks.incremental[0]);
  assert.ok(ctx.messages[1].additional_kwargs.noobotMessageId);
  assert.equal(ctx.messageBlocks.incrementalIds, undefined);
});

test("message store API marks summarized by ids", () => {
  const ctx = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  const message = appendMessage(ctx, { role: "assistant", content: "", tool_calls: [{ id: "call_1" }] }, {
    block: "incremental",
  });

  const changed = markSummarized(ctx, [message.additional_kwargs.noobotMessageId]);

  assert.equal(changed, 1);
  assert.equal(message.summarized, true);
  assert.equal(ctx.messageBlocks.incremental[0].summarized, true);
});
