/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOOK_POINT } from "@noobot/hook-protocol";
import { createModelContext } from "@noobot/context-protocol";
import { applyAgentResolvedModelMessages } from "../../src/core/model-message-context.js";
import { resolveCapabilityModelMessages } from "../../src/capabilities/handlers/shared/model/utils.js";

const point = HOOK_POINT.AGENT.BEFORE_LLM_CALL;
function context() {
  return {
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  };
}
const entries = [
  (ctx, resolver) =>
    applyAgentResolvedModelMessages(point, ctx, { resolveModelMessages: resolver }),
  (ctx, resolver) =>
    resolveCapabilityModelMessages(
      { harness: { resolveModelMessages: resolver } },
      { ctx, purpose: "main_agent" },
    ),
];

test("both model message entries reject corrupt contexts before invoking the resolver", () => {
  for (const apply of entries) {
    for (const ctx of [{}, { modelContext: null }, { modelContext: {} }]) {
      let called = false;
      assert.throws(
        () =>
          apply(ctx, () => {
            called = true;
            return [];
          }),
        /modelContext/,
      );
      assert.equal(called, false);
    }
    const ctx = context();
    ctx.modelContext.messageBlocks.history = null;
    assert.throws(() => apply(ctx, () => []), /messageBlocks.history/);
  }
});

test("both model message entries reject missing capability and invalid results without mutation", () => {
  for (const apply of entries) {
    const ctx = context();
    const before = structuredClone(ctx.modelContext);
    for (const resolver of [undefined, null, false]) {
      assert.throws(() => apply(ctx, resolver), /require.*resolver/);
    }
    for (const result of [undefined, null, {}, "", 0]) {
      assert.throws(() => apply(ctx, () => result), /must return a message array/);
      assert.deepEqual(ctx.modelContext, before);
    }
    const error = new Error("resolver failed");
    assert.throws(
      () =>
        apply(ctx, () => {
          throw error;
        }),
      (actual) => actual === error,
    );
  }
});

test("main entry accepts an explicit empty projection and ignores other hook points", () => {
  const ctx = context();
  assert.equal(
    applyAgentResolvedModelMessages(point, ctx, { resolveModelMessages: () => [] }),
    true,
  );
  assert.deepEqual(ctx.modelContext.messages, []);
  assert.equal(applyAgentResolvedModelMessages(HOOK_POINT.AGENT.AFTER_LLM_CALL), false);
});
