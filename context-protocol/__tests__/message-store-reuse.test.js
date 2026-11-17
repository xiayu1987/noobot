/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { attachModelContextRuntime } from "../src/assembly/model-runtime.js";
import {
  canonicalizeMessageStore,
  replaceMessageProjection,
  resolveMessagesByIds,
} from "../src/message/store.js";
import { resolveContextMessageSummarized } from "../src/message/codec.js";
import { contextMessage } from "./helpers/context-message.js";

function createHolder(message) {
  const holder = {
    messages: [message],
    messageBlocks: { system: [], history: [], incremental: [message] },
  };
  attachModelContextRuntime(holder);
  canonicalizeMessageStore(holder);
  return holder;
}

test("reusing canonical objects does not serialize their content again", () => {
  let serializations = 0;
  const message = contextMessage({
    messageUid: "stream",
    role: "assistant",
    content: {
      toJSON() {
        serializations += 1;
        return [{ type: "text", text: "streamed content" }];
      },
    },
  });
  const holder = createHolder(message);
  serializations = 0;

  replaceMessageProjection(holder, [message]);
  canonicalizeMessageStore(holder);

  assert.equal(serializations, 0);
  assert.equal(holder.messages[0], message);
  assert.equal(holder.messageBlocks.incremental[0], message);
});

test("canonical reuse retains in-place streaming content and summary state", () => {
  const message = contextMessage({ messageUid: "stream", role: "assistant", content: "first" });
  const holder = createHolder(message);
  message.content = "first and second";
  message.additional_kwargs.summarized = true;

  replaceMessageProjection(holder, [message]);

  assert.equal(holder.messages[0], message);
  assert.equal(holder.messageBlocks.incremental[0].content, "first and second");
  assert.equal(resolveContextMessageSummarized(holder.messages[0]), true);
  assert.equal(resolveMessagesByIds(holder, ["stream"])[0], message);
});

test("distinct matching objects still merge summary state into the canonical object", () => {
  const message = contextMessage({ messageUid: "stream", role: "assistant", content: "answer" });
  const holder = createHolder(message);
  const summarized = contextMessage({
    messageUid: "stream",
    role: "assistant",
    content: "answer",
    summarized: true,
  });

  replaceMessageProjection(holder, [summarized]);

  assert.equal(holder.messages[0], message);
  assert.equal(resolveContextMessageSummarized(message), true);
});

for (const [field, patch] of Object.entries({
  role: { role: "user" },
  content: { content: "different" },
  toolResult: { tool_call_id: "different" },
  toolCalls: { tool_calls: [{ id: "different", type: "function", function: { name: "tool" } }] },
  internalType: { noobotInternalMessageType: "user_meta" },
})) {
  test(`distinct objects with conflicting ${field} still reject the same identity`, () => {
    const message = contextMessage({ messageUid: "stream", role: "assistant", content: "answer" });
    const holder = createHolder(message);
    const conflicting = contextMessage({
      messageUid: "stream",
      role: "assistant",
      content: "answer",
      ...patch,
    });

    assert.throws(
      () => replaceMessageProjection(holder, [conflicting]),
      /canonical message id collision: stream/,
    );
    assert.equal(holder.messages[0], message);
  });
}

test("canonical reuse still validates identity before accepting the object", () => {
  const message = contextMessage({ messageUid: "stream", role: "assistant", content: "answer" });
  const holder = createHolder(message);
  message.additional_kwargs.contextMessageId = "second-identity";

  assert.throws(
    () => replaceMessageProjection(holder, [message]),
    /context message identity must be exactly one shape/,
  );
});

test("canonical reuse preserves metadata validation during summary state merging", () => {
  const message = contextMessage({ messageUid: "stream", role: "assistant", content: "answer" });
  const holder = createHolder(message);
  Object.assign(message.additional_kwargs, { summarized: true, injectedMessageType: "invalid" });

  assert.throws(
    () => replaceMessageProjection(holder, [message]),
    /injected context message requires additional_kwargs.injectedMessage/,
  );
});
