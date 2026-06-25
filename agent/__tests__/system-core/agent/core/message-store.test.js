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
  assert.equal(holder.messageBlocks.incrementalIds, undefined);
});

test("agent message store append and replace keep block arrays synchronized", () => {
  const holder = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  const appended = appendMessage(holder, { role: "user", content: "hello" }, { block: "incremental" });

  assert.equal(holder.messages[0], appended);
  assert.equal(holder.messageBlocks.incremental[0], appended);
  assert.ok(getMessageId(appended));
  assert.equal(holder.messageBlocks.incrementalIds, undefined);

  replaceMessages(holder, [{ role: "system", content: "sys" }, { role: "user", content: "hello" }]);
  writeMessageBlocks(holder, {
    system: [{ role: "system", content: "sys" }],
    history: [],
    incremental: [{ role: "user", content: "hello" }],
  });

  assert.equal(holder.messages[1], holder.messageBlocks.incremental[0]);
  assert.equal(holder.messageBlocks.systemIds, undefined);
  assert.equal(holder.messageBlocks.incrementalIds, undefined);
  assert.deepEqual(resolveMessagesByIds(holder, [getMessageId(holder.messageBlocks.incremental[0])]), [
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
  assert.ok(getMessageId(system));
  assert.equal(holder.messageBlocks.systemIds, undefined);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["hello"]);

  writeMessageBlocks(holder, { system: [] });
  assert.deepEqual(holder.messageBlocks.system, []);
  assert.equal(holder.messageBlocks.systemIds, undefined);
});

test("agent message store ignores provider id fields for block identity", () => {
  const holder = {
    messages: [
      { role: "system", content: "sys", id: "provider-collision" },
      { role: "user", content: "hist", id: "provider-collision" },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys", id: "provider-collision" }],
      history: [{ role: "user", content: "hist", id: "provider-collision" }],
      incremental: [],
    },
  };

  canonicalizeMessageStore(holder);

  assert.deepEqual(holder.messages.map((item = {}) => item.content), ["sys", "hist"]);
  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["hist"]);
  assert.notEqual(getMessageId(holder.messageBlocks.system[0]), getMessageId(holder.messageBlocks.history[0]));
});

test("agent message store advances next id when hydrating existing message ids", () => {
  const holder = {
    messages: [
      { role: "system", content: "sys", additional_kwargs: { noobotMessageId: "am_1" } },
      { role: "user", content: "old", additional_kwargs: { noobotMessageId: "am_2" } },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys", additional_kwargs: { noobotMessageId: "am_1" } }],
      history: [{ role: "user", content: "old", additional_kwargs: { noobotMessageId: "am_2" } }],
      incremental: [],
    },
  };

  canonicalizeMessageStore(holder);
  replaceMessages(holder, [
    { role: "system", content: "sys", additional_kwargs: { noobotInternalMessageType: "system_context" } },
    { role: "user", content: "new-without-id", dialogProcessId: "d-new" },
  ]);

  assert.deepEqual(holder.messages.map((item = {}) => getMessageId(item)), ["am_1", "am_3"]);
  assert.equal(new Set(holder.messages.map((item = {}) => getMessageId(item))).size, 2);
  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["old"]);
});

test("agent message store replaceMessages does not rewrite message block ownership", () => {
  const holder = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [{ role: "user", content: "hist", dialogProcessId: "d1" }],
      incremental: [{ role: "user", content: "cur", dialogProcessId: "d2" }],
    },
  };
  holder.messages = [
    ...holder.messageBlocks.system,
    ...holder.messageBlocks.history,
    ...holder.messageBlocks.incremental,
  ];
  canonicalizeMessageStore(holder);

  replaceMessages(holder, [
    { role: "system", content: "sys" },
    { role: "user", content: "hist", dialogProcessId: "d1" },
    { role: "user", content: "cur", dialogProcessId: "d2" },
  ]);

  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["hist"]);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["cur"]);
});
