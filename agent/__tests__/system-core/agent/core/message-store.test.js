/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendMessage,
  canonicalizeMessageStore,
  getMessageId,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
} from "../../../../src/system-core/agent/core/message-context/message-store.js";

test("agent message store canonicalizes messages and block views", () => {
  const currentForMessages = { role: "user", content: "current" };
  const currentForBlocks = { role: "user", content: "current" };
  const holder = {
    messages: [{ role: "system", content: "sys" }, currentForMessages],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [],
      incremental: [currentForBlocks],
    },
  };

  canonicalizeMessageStore(holder);

  assert.equal(holder.messages[1], holder.messageBlocks.incremental[0]);
  assert.ok(getMessageId(holder.messages[1]));
  assert.deepEqual(holder.messageBlocks.incrementalIds, [getMessageId(holder.messages[1])]);
});

test("agent message store append and replace keep block ids synchronized", () => {
  const holder = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  const appended = appendMessage(holder, { role: "user", content: "hello" }, { block: "incremental" });

  assert.equal(holder.messages[0], appended);
  assert.equal(holder.messageBlocks.incremental[0], appended);
  assert.deepEqual(holder.messageBlocks.incrementalIds, [getMessageId(appended)]);

  replaceMessages(holder, [{ role: "system", content: "sys" }, { role: "user", content: "hello" }]);
  writeMessageBlocks(holder, {
    system: [{ role: "system", content: "sys" }],
    history: [],
    incremental: [{ role: "user", content: "hello" }],
  });

  assert.equal(holder.messages[1], holder.messageBlocks.incremental[0]);
  assert.deepEqual(holder.messageBlocks.systemIds, [getMessageId(holder.messages[0])]);
  assert.deepEqual(holder.messageBlocks.incrementalIds, [getMessageId(holder.messages[1])]);
  assert.deepEqual(resolveMessagesByIds(holder, holder.messageBlocks.incrementalIds), [
    holder.messages[1],
  ]);
});

test("agent message store partial block writes preserve untouched blocks", () => {
  const holder = {
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  const system = appendMessage(holder, { role: "system", content: "sys" }, { block: "system" });

  writeMessageBlocks(holder, {
    incremental: [{ role: "user", content: "hello" }],
  });

  assert.equal(holder.messageBlocks.system[0], system);
  assert.deepEqual(holder.messageBlocks.systemIds, [getMessageId(system)]);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["hello"]);

  writeMessageBlocks(holder, { system: [] });
  assert.deepEqual(holder.messageBlocks.system, []);
  assert.deepEqual(holder.messageBlocks.systemIds, []);
});
