/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveContextMessageIdentity } from "@noobot/context-protocol/message/codec";
import { canonicalizeTestContextMessage } from "./context-message.js";
import {
  createTestHookContext,
  createTestResolveModelMessages,
  getTestContextMessages,
} from "./public-runtime-fixtures.js";
import { createModelContext } from "@noobot/context-protocol";

test("context fixture preserves explicit invalid session identity for protocol rejection", () => {
  for (const messageUid of ["", null, undefined]) {
    const message = canonicalizeTestContextMessage({
      role: "user",
      content: "invalid",
      additional_kwargs: { messageUid },
    });
    assert.equal(message.additional_kwargs.messageUid, messageUid);
    assert.throws(() => resolveContextMessageIdentity(message), /exactly one shape/);
  }
});

test("hook fixture preserves explicitly declared invalid round ownership", () => {
  for (const field of ["dialogProcessId", "turnScopeId"]) {
    const message = { role: "user", content: "invalid", additional_kwargs: { [field]: "" } };
    assert.doesNotThrow(() => {
      createTestHookContext({ messageBlocks: { system: [], history: [], incremental: [message] } });
    });
    assert.equal(message.additional_kwargs[field], "");
  }
});

test("hook fixture rejects supplied invalid model contexts without replacing them", () => {
  for (const modelContext of [null, {}, { protocolVersion: 2 }, { protocolVersion: 3 }]) {
    const ctx = { modelContext };
    const before = structuredClone(modelContext);
    assert.throws(() => createTestHookContext(ctx), /modelContext/);
    assert.equal(ctx.modelContext, modelContext);
    assert.deepEqual(modelContext, before);
  }
});

test("test model resolver rejects corrupt message lanes without supplying empty arrays", () => {
  const modelContext = createModelContext({
    messageBlocks: { system: [], history: [], incremental: [] },
  });
  modelContext.messageBlocks.history = null;
  const before = structuredClone(modelContext);
  assert.throws(
    () => createTestResolveModelMessages()({ ctx: { modelContext } }),
    /messageBlocks.history/,
  );
  assert.deepEqual(modelContext, before);
});

test("test context reader rejects missing or damaged contexts and preserves admitted messages", () => {
  for (const ctx of [undefined, null, {}, { modelContext: null }, { modelContext: {} }]) {
    assert.throws(() => getTestContextMessages(ctx), /modelContext/);
  }
  const ctx = createTestHookContext();
  assert.equal(getTestContextMessages(ctx), ctx.modelContext.messages);
  ctx.modelContext.messageBlocks.history = null;
  assert.throws(() => getTestContextMessages(ctx), /messageBlocks.history/);
});
