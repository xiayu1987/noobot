/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createModelContext } from "../src/hook-context.js";
import {
  CONTEXT_MUTATION_TYPES,
  createContextMutation,
  dispatchContextMutation,
} from "../src/context-mutation.js";

test("model context document excludes runtime capabilities and is JSON serializable", () => {
  const document = createModelContext({
    messages: [{ role: "user", content: "hello" }],
    messageBlocks: { system: [], history: [], incremental: [{ role: "user", content: "hello" }] },
    onCanonicalMessageAdded() {},
  });

  assert.equal(Object.hasOwn(document, "messageStore"), false);
  assert.equal(Object.hasOwn(document, "onCanonicalMessageAdded"), false);
  assert.doesNotThrow(() => JSON.stringify(document));
});

test("context mutation consumes one exact revision and rejects replay", () => {
  const consumed = [];
  const document = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
    onMutationConsumed(result) { consumed.push(result); },
  });
  const command = createContextMutation(document, CONTEXT_MUTATION_TYPES.APPEND_MESSAGE, {
    message: { role: "user", content: "hello" },
    block: "incremental",
  });

  const result = dispatchContextMutation(document, command);
  assert.equal(result.accepted, true);
  assert.equal(result.revision, 1);
  assert.equal(document.messageBlocks.incremental.length, 1);
  assert.equal(consumed[0].commandId, command.commandId);
  assert.throws(() => dispatchContextMutation(document, command), /revision conflict/);
});
