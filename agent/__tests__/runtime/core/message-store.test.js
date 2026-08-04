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
  pruneSummarizedIncrementalMessages,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
} from "../../../src/context/runtime-state/message-store.js";

test("agent message store canonicalizes messages and block views", () => {
  const system = { role: "system", content: "sys" };
  const currentForMessages = { role: "user", content: "current" };
  const holder = {
    messages: [system, currentForMessages],
    messageBlocks: {
      system: [system],
      history: [],
      incremental: [currentForMessages],
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

  const replacement = replaceMessages(holder, [
    { role: "system", content: "sys" },
    appended,
  ]);
  writeMessageBlocks(holder, {
    system: [replacement[0]],
    history: [],
    incremental: [replacement[1]],
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

test("agent message store ignores provider and business ids for block identity", () => {
  const holder = {
    messages: [
      { role: "system", content: "sys", id: "provider-collision", messageId: "business-collision" },
      { role: "user", content: "hist", id: "provider-collision", messageId: "business-collision" },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys", id: "provider-collision", messageId: "business-collision" }],
      history: [{ role: "user", content: "hist", id: "provider-collision", messageId: "business-collision" }],
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
  const canonicalSystemMessage = holder.messageBlocks.system[0];
  replaceMessages(holder, [
    canonicalSystemMessage,
    {
      role: "user",
      content: "new-without-id",
      dialogProcessId: "d-new",
      turnScopeId: "t-new",
    },
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
    holder.messageBlocks.system[0],
    holder.messageBlocks.history[0],
    holder.messageBlocks.incremental[0],
  ]);

  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["hist"]);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["cur"]);
});

test("summary pruning clears only incremental blocks and rebuilds canonical indexes", () => {
  const summarizedHistory = { role: "assistant", content: "history-summary", summarized: true };
  const summarizedIncremental = { role: "assistant", content: "old-increment", summarized: true };
  const activeIncremental = { role: "tool", content: "latest-summary" };
  const holder = {
    messages: [
      { role: "system", content: "sys" },
      summarizedHistory,
      summarizedIncremental,
      activeIncremental,
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [summarizedHistory],
      incremental: [summarizedIncremental, activeIncremental],
    },
  };
  canonicalizeMessageStore(holder);
  const removedIncrementalId = getMessageId(holder.messageBlocks.incremental[0]);

  assert.equal(pruneSummarizedIncrementalMessages(holder), 1);
  assert.deepEqual(holder.messages.map((item = {}) => item.content), ["sys", "latest-summary"]);
  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["history-summary"]);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["latest-summary"]);
  assert.deepEqual(resolveMessagesByIds(holder, [removedIncrementalId]), []);
  assert.equal(holder.messageStore.messages.some((item = {}) => item.content === "old-increment"), false);
  assert.equal(holder.messageStore.messages.some((item = {}) => item.content === "history-summary"), true);
});

test("summary pruning preserves every unmarked incremental message byte-for-byte and in order", () => {
  const id = (value) => ({ additional_kwargs: { noobotMessageId: value } });
  const holder = {
    messages: [
      { role: "system", content: "sys", ...id("sys") },
      { role: "user", content: "same", metadata: { keep: 1 }, ...id("keep-1") },
      { role: "assistant", content: "drop", summarized: true, ...id("drop") },
      { role: "user", content: "same", metadata: { keep: 2 }, ...id("keep-2") },
    ],
    messageBlocks: {
      system: [{ role: "system", content: "sys", ...id("sys") }],
      history: [],
      incremental: [
        { role: "user", content: "same", metadata: { keep: 1 }, ...id("keep-1") },
        { role: "assistant", content: "drop", summarized: true, ...id("drop") },
        { role: "user", content: "same", metadata: { keep: 2 }, ...id("keep-2") },
      ],
    },
  };
  canonicalizeMessageStore(holder);
  const expectedIncremental = structuredClone(
    holder.messageBlocks.incremental.filter((message) => message.summarized !== true),
  );
  const expectedIds = holder.messageBlocks.incremental
    .filter((message) => message.summarized !== true)
    .map((message) => getMessageId(message));

  pruneSummarizedIncrementalMessages(holder);

  assert.deepEqual(holder.messageBlocks.incremental, expectedIncremental);
  assert.deepEqual(
    holder.messageBlocks.incremental.map((message) => getMessageId(message)),
    expectedIds,
  );
});
