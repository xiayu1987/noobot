/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelContext,
  requireAuthoritativeModelContext,
} from "../src/assembly/hook-context.js";

function context() {
  return {
    modelContext: createModelContext({
      messageBlocks: { system: [], history: [], incremental: [] },
    }),
  };
}

test("required model context preserves authoritative references and legal empty lanes", () => {
  const ctx = context();
  assert.equal(requireAuthoritativeModelContext(ctx), ctx.modelContext);
  assert.deepEqual(ctx.modelContext.messages, []);
});

test("required model context rejects damaged containers without repairing them", () => {
  for (const field of ["messages", "messageBlocks", "history", "incremental", "system"]) {
    for (const value of [undefined, null, {}, "invalid"]) {
      const ctx = context();
      const target = ["messages", "messageBlocks"].includes(field)
        ? ctx.modelContext
        : ctx.modelContext.messageBlocks;
      target[field] = value;
      const before = structuredClone(ctx);
      assert.throws(() => requireAuthoritativeModelContext(ctx), TypeError);
      assert.deepEqual(ctx, before);
    }
  }
});

test("required model context rejects absent and unsupported contexts", () => {
  for (const ctx of [undefined, null, {}, { modelContext: { protocolVersion: -1 } }]) {
    assert.throws(() => requireAuthoritativeModelContext(ctx), /protocolVersion/);
  }
});
