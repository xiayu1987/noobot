/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { deepFreeze } from "@noobot/shared/deep-freeze";
import {
  partitionTurnMessages,
  requireTurnPartitionIdentity,
  requireTurnPartitionMessageIdentity,
} from "../src/index.js";

const user = { role: "user", turnScopeId: "scope-1", dialogProcessId: "dp-1" };
const assistant = { ...user, role: "assistant", presentationMessageId: "pm-1" };

function originalPartition(messages) {
  const buckets = new Map();
  messages.forEach((message, sourceIndex) => {
    const { turnScopeId, dialogProcessId } = requireTurnPartitionMessageIdentity(
      message,
      sourceIndex,
    );
    const bucket = buckets.get(turnScopeId) || {
      turnScopeId,
      dialogProcessId,
      firstSourceIndex: sourceIndex,
      messages: [],
    };
    bucket.messages.push(message);
    buckets.set(turnScopeId, bucket);
  });
  for (const bucket of buckets.values()) requireTurnPartitionIdentity(bucket.messages);
  return [...buckets.values()];
}

function outcome(operation) {
  try {
    return { value: operation() };
  } catch (error) {
    return { code: error.code, message: error.message };
  }
}

test("single-pass grouping matches the existing ownership, ordering and error precedence", () => {
  const other = { ...user, turnScopeId: "scope-2", dialogProcessId: "dp-2" };
  const conflict = { ...assistant, dialogProcessId: "dp-conflict" };
  const cases = [
    [],
    [user],
    [user, assistant, other, { ...assistant, role: "tool" }],
    [user, conflict],
    [user, conflict, { ...assistant, presentationMessageId: "" }],
    [user, conflict, { ...other, dialogProcessId: "" }],
    [assistant, { ...assistant, presentationMessageId: "pm-2" }],
    [user, other, { ...other, dialogProcessId: "dp-conflict" }, conflict],
  ];
  for (const messages of cases) {
    for (const input of [messages, deepFreeze(structuredClone(messages))]) {
      assert.deepEqual(
        outcome(() => partitionTurnMessages(input)),
        outcome(() => originalPartition(input)),
      );
    }
  }
});

test("grouping owns its arrays and revalidates mutable inputs on every call", () => {
  const message = { ...assistant };
  const messages = [message];
  const grouped = partitionTurnMessages(messages);
  assert.equal(grouped[0].messages[0], message);
  grouped[0].messages.push(user);
  grouped[0].dialogProcessId = "consumer mutation";
  assert.deepEqual(partitionTurnMessages(messages), originalPartition(messages));
  message.presentationMessageId = "";
  assert.match(outcome(() => partitionTurnMessages(messages)).message, /at index 0/);
});

test("partition identity still reports a later required-field error before an earlier conflict", () => {
  const messages = [
    user,
    { ...user, dialogProcessId: "dp-other" },
    { ...assistant, presentationMessageId: "" },
  ];
  assert.match(outcome(() => requireTurnPartitionIdentity(messages)).message, /at index 2/);
});
