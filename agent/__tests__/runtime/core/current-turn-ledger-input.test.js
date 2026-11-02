/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";

const messages = () => [
  { messageUid: "a", content: "first" },
  { messageUid: "b", content: "second" },
];

test("ledger and agent results share container, identity and uniqueness admission", () => {
  for (const input of [
    null,
    {},
    [null],
    new Array(1),
    [{ messageUid: " a " }],
    [{ messageUid: "a" }, { messageUid: "a" }],
  ]) {
    assert.throws(() => createCurrentTurnMessagesStore(input), {
      code: "AGENT_TURN_RESULT_INVALID",
    });
  }
  assert.deepEqual(createCurrentTurnMessagesStore([]).toArray(), []);
});

test("ledger refuses invalid pushes, replacement and patches without partial updates", () => {
  const store = createCurrentTurnMessagesStore(messages());
  for (const mutate of [
    () => store.push({ messageUid: "a" }),
    () => store.push(null),
    () => store.replaceAll([{ messageUid: "a" }, null]),
    () => store.updateLast({ messageUid: "a" }),
    () => store.updateLast({ messageUid: undefined }),
    () => store.updateLast(null),
    () => store.updateWhere({ messageUid: "same" }),
    () => store.updateWhere({ messageUid: " a " }),
  ]) {
    assert.throws(mutate);
    assert.deepEqual(store.toArray(), messages());
  }
});

test("ledger applies valid matching updates and keeps input messages unchanged", () => {
  const input = messages();
  const store = createCurrentTurnMessagesStore(input);
  assert.equal(
    store.updateWhere({ content: "updated" }, (message) => message.messageUid === "a"),
    1,
  );
  assert.equal(store.updateLast({ content: "last" }).messageUid, "b");
  assert.deepEqual(store.toArray(), [
    { messageUid: "a", content: "updated" },
    { messageUid: "b", content: "last" },
  ]);
  assert.deepEqual(input, messages());
});
