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
  pruneSummarizedIncrementalMessages,
  replaceMessages,
  resolveMessagesByIds,
  writeMessageBlocks,
} from "../src/message/store.js";
import {
  readContextMessageField,
  resolveContextMessageKey,
  resolveContextMessageSummarized,
} from "../src/message/codec.js";
import { attachModelContextRuntime } from "../src/assembly/model-runtime.js";
import { contextMessage } from "./helpers/context-message.js";
import { MESSAGE_REMOVED_FIELD_NAME } from "@noobot/session-protocol";

const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

function attachRuntime(holder, options = {}) {
  attachModelContextRuntime(holder, options);
  return holder;
}

function msg(messageUid, fields = {}) {
  return contextMessage({ messageUid, ...fields });
}

function roundIdentity(message) {
  return {
    dialogProcessId: readContextMessageField(message, "dialogProcessId"),
    turnScopeId: readContextMessageField(message, "turnScopeId"),
  };
}

test("persisted entities use messageUid as their only canonical context identity", () => {
  const message = msg("sm_injected", { role: "user", content: "injected" });
  const holder = { messages: [message] };
  attachRuntime(holder);

  canonicalizeMessageStore(holder);

  assert.equal(resolveContextMessageKey(message), "sm_injected");
  assert.equal(message.additional_kwargs[MESSAGE_REMOVED_FIELD_NAME.NOOBOT_MESSAGE_ID], undefined);
});

test("canonical store rejects context messages without identity", () => {
  const holder = { messages: [contextMessage({ role: "system", content: "no-id" })] };
  attachRuntime(holder);

  assert.throws(
    () => canonicalizeMessageStore(holder),
    /context message identity must be exactly one shape, got: none/,
  );
  assert.throws(
    () =>
      appendMessage(
        attachRuntime({
          messages: [],
          messageBlocks: { system: [], history: [], incremental: [] },
        }),
        contextMessage({ role: "user", content: "no-id" }),
        { block: "incremental" },
      ),
    /context message identity must be exactly one shape, got: none/,
  );
});

test("canonical store rejects one identity assigned to different message entities", () => {
  const holder = {
    messages: [
      msg("sm_user", { role: "user", content: "question" }),
      msg("sm_user", {
        role: "user",
        content: "[user metadata]",
        noobotInternalMessageType: "user_meta",
      }),
    ],
  };
  attachRuntime(holder);

  assert.throws(() => canonicalizeMessageStore(holder), /canonical message id collision: sm_user/);
});

test("agent message store canonicalizes messages and block views", () => {
  const system = msg("sys", { role: "system", content: "sys" });
  const currentForMessages = msg("cur", { role: "user", content: "current" });
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
  assert.equal(resolveContextMessageKey(holder.messages[1]), "cur");
  assert.equal(holder.messageBlocks.incrementalIds, undefined);
});

test("agent message store append and replace keep block arrays synchronized", () => {
  const holder = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  attachRuntime(holder);
  const appended = appendMessage(holder, msg("hello", { role: "user", content: "hello" }), {
    block: "incremental",
  });

  assert.equal(holder.messages[0], appended);
  assert.equal(holder.messageBlocks.incremental[0], appended);
  assert.equal(resolveContextMessageKey(appended), "hello");
  assert.equal(holder.messageBlocks.incrementalIds, undefined);

  const replacement = replaceMessages(holder, [
    msg("sys", { role: "system", content: "sys" }),
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
  assert.deepEqual(resolveMessagesByIds(holder, ["hello"]), [holder.messages[1]]);
});

test("append atomically assigns the authoritative active turn identity without mutating input", () => {
  const holder = {
    activeTurnIdentity: {
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
    },
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  attachRuntime(holder);

  const source = Object.freeze(
    msg("a1", { role: "assistant", content: "", dialogProcessId: "dialog-current" }),
  );
  const appended = appendMessage(holder, source, { block: "incremental" });

  assert.notEqual(appended, source);
  assert.equal(readContextMessageField(source, "turnScopeId"), "");
  assert.deepEqual(roundIdentity(appended), holder.activeTurnIdentity);
  assert.throws(
    () =>
      appendMessage(
        holder,
        msg("t1", {
          role: "tool",
          content: "result",
          dialogProcessId: "dialog-other",
          turnScopeId: "turn-current",
        }),
        { block: "incremental" },
      ),
    /conflicts with the active turn identity/,
  );
});

test("append rejects partial canonical round identities when no active turn exists", () => {
  const holder = { messages: [], messageBlocks: { system: [], history: [], incremental: [] } };
  attachRuntime(holder);

  assert.throws(
    () =>
      appendMessage(
        holder,
        msg("t1", { role: "tool", content: "result", dialogProcessId: "dialog-only" }),
        { block: "incremental" },
      ),
    /must contain dialogProcessId and turnScopeId as one identity/,
  );
});

test("replace and block writes bind only newly registered entities to the active turn", () => {
  const observed = [];
  const historical = msg("hist", {
    role: "assistant",
    content: "history",
    dialogProcessId: "dialog-history",
    turnScopeId: "turn-history",
  });
  const holder = {
    activeTurnIdentity: {
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
    },
    messages: [historical],
    messageBlocks: { system: [], history: [historical], incremental: [] },
  };
  attachRuntime(holder, {
    onCanonicalMessageAdded(message, meta) {
      observed.push({ message, meta });
    },
  });
  canonicalizeMessageStore(holder);
  const prepended = msg("inj", {
    role: "user",
    content: "injected",
    dialogProcessId: "dialog-current",
  });

  const [canonicalPrepended] = replaceMessages(holder, [prepended, historical]);
  const dynamicSystem = msg("dyn", { role: "system", content: "dynamic" });
  writeMessageBlocks(holder, {
    system: [dynamicSystem],
    history: [historical],
    incremental: [canonicalPrepended],
  });
  const canonicalDynamicSystem = holder.messageBlocks.system[0];

  assert.deepEqual(roundIdentity(canonicalPrepended), holder.activeTurnIdentity);
  assert.deepEqual(roundIdentity(canonicalDynamicSystem), holder.activeTurnIdentity);
  assert.equal(readContextMessageField(prepended, "turnScopeId"), "");
  assert.equal(readContextMessageField(dynamicSystem, "dialogProcessId"), "");
  assert.deepEqual(roundIdentity(historical), {
    dialogProcessId: "dialog-history",
    turnScopeId: "turn-history",
  });
  assert.deepEqual(
    observed.map(({ meta }) => meta.operation),
    ["replace", "write_blocks"],
  );
});

test("agent message store partial block writes preserve untouched blocks", () => {
  const holder = {
    messages: [],
    messageBlocks: { system: [], history: [], incremental: [] },
  };
  attachRuntime(holder);
  const system = appendMessage(holder, msg("sys", { role: "system", content: "sys" }), {
    block: "system",
  });

  writeMessageBlocks(holder, {
    incremental: [msg("hello", { role: "user", content: "hello" })],
  });

  assert.equal(holder.messageBlocks.system[0], system);
  assert.equal(holder.messageBlocks.systemIds, undefined);
  assert.deepEqual(
    holder.messageBlocks.incremental.map((item = {}) => item.content),
    ["hello"],
  );

  writeMessageBlocks(holder, { system: [] });
  assert.deepEqual(holder.messageBlocks.system, []);
  assert.equal(holder.messageBlocks.systemIds, undefined);
});

test("agent message store ignores provider and business ids for block identity", () => {
  const fields = { id: "provider-collision", [LEGACY_MESSAGE_ID]: "business-collision" };
  const holder = {
    messages: [
      msg("sys", { role: "system", content: "sys", ...fields }),
      msg("hist", { role: "user", content: "hist", ...fields }),
    ],
    messageBlocks: {
      system: [msg("sys", { role: "system", content: "sys", ...fields })],
      history: [msg("hist", { role: "user", content: "hist", ...fields })],
      incremental: [],
    },
  };
  attachRuntime(holder);

  canonicalizeMessageStore(holder);

  assert.deepEqual(
    holder.messages.map((item = {}) => item.content),
    ["sys", "hist"],
  );
  assert.equal(holder.messageBlocks.system[0], holder.messages[0]);
  assert.equal(holder.messageBlocks.history[0], holder.messages[1]);
  assert.deepEqual(
    [
      resolveContextMessageKey(holder.messageBlocks.system[0]),
      resolveContextMessageKey(holder.messageBlocks.history[0]),
    ],
    ["sys", "hist"],
  );
});

test("agent message store replaceMessages does not rewrite message block ownership", () => {
  const holder = {
    messages: [],
    messageBlocks: {
      system: [msg("sys", { role: "system", content: "sys" })],
      history: [
        msg("hist", { role: "user", content: "hist", dialogProcessId: "d1", turnScopeId: "t1" }),
      ],
      incremental: [
        msg("cur", { role: "user", content: "cur", dialogProcessId: "d2", turnScopeId: "t2" }),
      ],
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

  assert.deepEqual(
    holder.messageBlocks.system.map((item = {}) => item.content),
    ["sys"],
  );
  assert.deepEqual(
    holder.messageBlocks.history.map((item = {}) => item.content),
    ["hist"],
  );
  assert.deepEqual(
    holder.messageBlocks.incremental.map((item = {}) => item.content),
    ["cur"],
  );
});

test("summary pruning clears only incremental blocks and rebuilds canonical indexes", () => {
  const summarizedHistory = msg("h1", {
    role: "assistant",
    content: "history-summary",
    summarized: true,
  });
  const summarizedIncremental = msg("i1", {
    role: "assistant",
    content: "old-increment",
    summarized: true,
  });
  const activeIncremental = msg("i2", { role: "tool", content: "latest-summary" });
  const holder = {
    messages: [
      msg("sys", { role: "system", content: "sys" }),
      summarizedHistory,
      summarizedIncremental,
      activeIncremental,
    ],
    messageBlocks: {
      system: [msg("sys", { role: "system", content: "sys" })],
      history: [summarizedHistory],
      incremental: [summarizedIncremental, activeIncremental],
    },
  };
  attachRuntime(holder);
  canonicalizeMessageStore(holder);

  assert.equal(pruneSummarizedIncrementalMessages(holder), 1);
  assert.deepEqual(
    holder.messages.map((item = {}) => item.content),
    ["sys", "latest-summary"],
  );
  assert.deepEqual(
    holder.messageBlocks.system.map((item = {}) => item.content),
    ["sys"],
  );
  assert.deepEqual(
    holder.messageBlocks.history.map((item = {}) => item.content),
    ["history-summary"],
  );
  assert.deepEqual(
    holder.messageBlocks.incremental.map((item = {}) => item.content),
    ["latest-summary"],
  );
  assert.deepEqual(resolveMessagesByIds(holder, ["i1"]), []);
});

test("summary pruning preserves every unmarked incremental message byte-for-byte and in order", () => {
  const holder = {
    messages: [
      msg("sys", { role: "system", content: "sys" }),
      msg("keep-1", { role: "user", content: "same", metadata: { keep: 1 } }),
      msg("drop", { role: "assistant", content: "drop", summarized: true }),
      msg("keep-2", { role: "user", content: "same", metadata: { keep: 2 } }),
    ],
    messageBlocks: {
      system: [msg("sys", { role: "system", content: "sys" })],
      history: [],
      incremental: [
        msg("keep-1", { role: "user", content: "same", metadata: { keep: 1 } }),
        msg("drop", { role: "assistant", content: "drop", summarized: true }),
        msg("keep-2", { role: "user", content: "same", metadata: { keep: 2 } }),
      ],
    },
  };
  attachRuntime(holder);
  canonicalizeMessageStore(holder);
  const unmarked = holder.messageBlocks.incremental.filter(
    (message) => !resolveContextMessageSummarized(message),
  );
  const expectedIncremental = structuredClone(unmarked);

  pruneSummarizedIncrementalMessages(holder);

  assert.deepEqual(holder.messageBlocks.incremental, expectedIncremental);
  assert.deepEqual(holder.messageBlocks.incremental.map(resolveContextMessageKey), [
    "keep-1",
    "keep-2",
  ]);
});
