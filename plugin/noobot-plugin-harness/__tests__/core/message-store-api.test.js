/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendMessage,
  replaceMessages,
  writeMessageBlocks,
} from "../../src/core/message-store.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";
import { canonicalizeTestContextMessage } from "../helpers/context-message.js";

test("message store API appends messages and keeps block arrays synchronized", () => {
  const ctx = createTestHookContext();
  const message = appendMessage(
    ctx,
    canonicalizeTestContextMessage({ role: "user", content: "hello" }),
    { block: "incremental" },
  );

  assert.equal(ctx.modelContext.messages[0], message);
  assert.equal(ctx.modelContext.messageBlocks.incremental[0], message);
  assert.ok(message.additional_kwargs.messageUid);
  assert.equal(ctx.modelContext.messageBlocks.incrementalIds, undefined);
});

test("message store API replaces messages and writes canonical block views", () => {
  const ctx = createTestHookContext();
  const toolCall = canonicalizeTestContextMessage({
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", function: { name: "write_file" } }],
  });
  const systemMessage = canonicalizeTestContextMessage({ role: "system", content: "sys" });
  const toolCopy = structuredClone(toolCall);

  replaceMessages(ctx, [structuredClone(systemMessage), toolCall]);
  writeMessageBlocks(ctx, {
    system: [structuredClone(systemMessage)],
    history: [],
    incremental: [toolCopy],
  });

  assert.equal(ctx.modelContext.messages[1], ctx.modelContext.messageBlocks.incremental[0]);
  assert.ok(ctx.modelContext.messages[1].additional_kwargs.messageUid);
  assert.equal(ctx.modelContext.messageBlocks.incrementalIds, undefined);
});
