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
  deriveMessageProjectionId,
  getMessageId,
  pruneSummarizedIncrementalMessages,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
} from "../src/message-store.js";
import {
  attachModelContextRuntime,
  resolveCanonicalContextMessages,
} from "../src/model-context-runtime.js";

function attachRuntime(holder, options = {}) {
  attachModelContextRuntime(holder, options);
  return holder;
}

test("derived projections receive a deterministic identity distinct from their source", () => {
  assert.equal(deriveMessageProjectionId("sm_user", "user_meta"), "sm_user::user_meta");
  assert.notEqual(deriveMessageProjectionId("sm_user", "user_meta"), "sm_user");
});

test("persisted entities use messageUid as their canonical context identity", () => {
  const message = { messageUid: "sm_injected", role: "user", content: "injected" };
  const holder = { messages: [message] };
  attachRuntime(holder);

  canonicalizeMessageStore(holder);

  assert.equal(getMessageId(message), "sm_injected");
  assert.equal(message.additional_kwargs.noobotMessageId, "sm_injected");
  assert.equal(resolveCanonicalContextMessages(holder)[0], message);
});

test("persisted and canonical identities cannot diverge", () => {
  assert.throws(
    () => canonicalizeMessageStore(attachRuntime({
      messages: [{
        messageUid: "sm_persisted",
        role: "user",
        content: "injected",
        additional_kwargs: { noobotMessageId: "am_parallel" },
      }],
    })),
    /messageUid conflicts with canonical noobotMessageId/,
  );
});

test("canonical store rejects one identity assigned to different message entities", () => {
  const holder = {
    messages: [
      { role: "user", content: "question", additional_kwargs: { noobotMessageId: "sm_user" } },
      {
        role: "user",
        content: "[user metadata]",
        additional_kwargs: {
          noobotMessageId: "sm_user",
          noobotInternalMessageType: "user_meta",
        },
      },
    ],
  };
  attachRuntime(holder);

  assert.throws(
    () => canonicalizeMessageStore(holder),
    /canonical message id collision: sm_user/,
  );
});

test("canonical store reserves explicit ids before assigning ids to unidentified entities", () => {
  const holder = {
    messageBlocks: {
      system: [{ role: "system", content: "new-without-id" }],
      history: [
        {
          role: "assistant",
          content: "persisted-context-entity",
          additional_kwargs: { noobotMessageId: "am_1" },
        },
      ],
      incremental: [],
    },
  };
  attachRuntime(holder);

  canonicalizeMessageStore(holder);

  assert.equal(getMessageId(holder.messageBlocks.system[0]), "am_2");
  assert.equal(getMessageId(holder.messageBlocks.history[0]), "am_1");
  assert.equal(resolveCanonicalContextMessages(holder).includes(holder.messageBlocks.history[0]), true);
  assert.equal(resolveCanonicalContextMessages(holder).includes(holder.messageBlocks.system[0]), true);
});

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
  attachRuntime(holder);

  canonicalizeMessageStore(holder);

  assert.equal(holder.messages[1], holder.messageBlocks.incremental[0]);
  assert.ok(getMessageId(holder.messages[1]));
  assert.equal(holder.messageBlocks.incrementalIds, undefined);
});

test("agent message store append and replace keep block arrays synchronized", () => {
  const holder = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  attachRuntime(holder);
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

test("append atomically assigns the authoritative active turn identity", () => {
  const holder = {
    activeTurnIdentity: {
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
    },
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  attachRuntime(holder);

  const appended = appendMessage(holder, {
    role: "assistant",
    content: "",
    dialogProcessId: "dialog-current",
  }, { block: "incremental" });

  assert.equal(appended.dialogProcessId, "dialog-current");
  assert.equal(appended.turnScopeId, "turn-current");
  assert.throws(
    () => appendMessage(holder, {
      role: "tool",
      content: "result",
      dialogProcessId: "dialog-other",
      turnScopeId: "turn-current",
    }, { block: "incremental" }),
    /conflicts with the active turn identity/,
  );
});

test("append rejects partial canonical round identities when no active turn exists", () => {
  const holder = {
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  attachRuntime(holder);
  assert.throws(
    () => appendMessage(holder, {
      role: "tool",
      content: "result",
      dialogProcessId: "dialog-only",
    }, { block: "incremental" }),
    /must contain dialogProcessId and turnScopeId as one identity/,
  );
});

test("replace and block writes bind only newly registered entities to the active turn", () => {
  const observed = [];
  const historical = {
    role: "assistant",
    content: "history",
    dialogProcessId: "dialog-history",
    turnScopeId: "turn-history",
  };
  const holder = {
    activeTurnIdentity: {
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
    },
    onCanonicalMessageAdded(message, meta) {
      observed.push({ message, meta });
    },
    messages: [historical],
    messageBlocks: { system: [], history: [historical], incremental: [] },
  };
  attachRuntime(holder, { onCanonicalMessageAdded: holder.onCanonicalMessageAdded });
  canonicalizeMessageStore(holder);
  const prepended = {
    role: "user",
    content: "injected",
    dialogProcessId: "dialog-current",
  };

  replaceMessages(holder, [prepended, historical]);
  const dynamicSystem = { role: "system", content: "dynamic" };
  writeMessageBlocks(holder, {
    system: [dynamicSystem],
    history: [historical],
    incremental: [prepended],
  });

  assert.deepEqual(
    { dialogProcessId: prepended.dialogProcessId, turnScopeId: prepended.turnScopeId },
    holder.activeTurnIdentity,
  );
  assert.deepEqual(
    { dialogProcessId: dynamicSystem.dialogProcessId, turnScopeId: dynamicSystem.turnScopeId },
    holder.activeTurnIdentity,
  );
  assert.deepEqual(
    { dialogProcessId: historical.dialogProcessId, turnScopeId: historical.turnScopeId },
    { dialogProcessId: "dialog-history", turnScopeId: "turn-history" },
  );
  assert.deepEqual(observed.map(({ meta }) => meta.operation), ["replace", "write_blocks"]);
});

test("agent message store partial block writes preserve untouched blocks", () => {
  const holder = {
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  attachRuntime(holder);
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
  attachRuntime(holder);

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
  attachRuntime(holder);

  canonicalizeMessageStore(holder);
  const canonicalSystemMessage = holder.messageBlocks.system[0];
  replaceMessages(holder, [
    canonicalSystemMessage,
    { role: "user", content: "new-without-id", dialogProcessId: "d-new", turnScopeId: "t-new" },
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
  attachRuntime(holder);
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
  attachRuntime(holder);
  canonicalizeMessageStore(holder);
  const removedIncrementalId = getMessageId(holder.messageBlocks.incremental[0]);

  assert.equal(pruneSummarizedIncrementalMessages(holder), 1);
  assert.deepEqual(holder.messages.map((item = {}) => item.content), ["sys", "latest-summary"]);
  assert.deepEqual(holder.messageBlocks.system.map((item = {}) => item.content), ["sys"]);
  assert.deepEqual(holder.messageBlocks.history.map((item = {}) => item.content), ["history-summary"]);
  assert.deepEqual(holder.messageBlocks.incremental.map((item = {}) => item.content), ["latest-summary"]);
  assert.deepEqual(resolveMessagesByIds(holder, [removedIncrementalId]), []);
  assert.equal(resolveCanonicalContextMessages(holder).some((item = {}) => item.content === "old-increment"), false);
  assert.equal(resolveCanonicalContextMessages(holder).some((item = {}) => item.content === "history-summary"), true);
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
  attachRuntime(holder);
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
