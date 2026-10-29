/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ERROR_CODE,
  requireTurnPartitionIdentity,
  requireTurnPartitionMessageIdentity,
} from "../src/index.js";

const user = { role: "user", turnScopeId: "scope-1", dialogProcessId: "dp-1" };
const assistant = { ...user, role: "assistant", presentationMessageId: "pm_1" };
const tool = { ...user, role: "tool", presentationMessageId: "pm_1" };

test("turn partition identity resolves the single presentation identity of a Turn", () => {
  assert.deepEqual(requireTurnPartitionIdentity([user, assistant, tool]), {
    turnScopeId: "scope-1",
    dialogProcessId: "dp-1",
    presentationMessageId: "pm_1",
  });
});

test("turn partition identity of a user-only Turn has no presentation identity", () => {
  assert.equal(requireTurnPartitionIdentity([user]).presentationMessageId, null);
});

test("turn partition message identity rejects missing or padded Turn identity", () => {
  for (const message of [
    null,
    { role: "user", dialogProcessId: "dp-1" },
    { role: "user", turnScopeId: "scope-1" },
    { ...user, dialogProcessId: " dp-1 " },
    { ...user, turnScopeId: " scope-1 " },
    { ...assistant, presentationMessageId: "" },
  ]) {
    assert.throws(() => requireTurnPartitionMessageIdentity(message, 0), {
      code: SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
    });
  }
});

test("turn partition identity rejects conflicting identities inside one Turn", () => {
  for (const messages of [
    [user, { ...assistant, dialogProcessId: "dp-2" }],
    [assistant, { ...tool, presentationMessageId: "pm_2" }],
    [user, { ...user, turnScopeId: "scope-2" }],
  ]) {
    assert.throws(() => requireTurnPartitionIdentity(messages), {
      code: SESSION_ERROR_CODE.TURN_IDENTITY_CONFLICT,
    });
  }
  assert.throws(() => requireTurnPartitionIdentity([]), {
    code: SESSION_ERROR_CODE.TURN_IDENTITY_REQUIRED,
  });
});
