/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { HOOK_PROTOCOL_VERSION } from "@noobot/hook-protocol";
import { MODEL_CONTEXT_PROTOCOL_VERSION } from "../src/agent-context/schema.js";
import { attachModelContext } from "../src/assembly/hook-context.js";

test("attachModelContext attaches the authoritative object without copying", () => {
  const context = { point: "before_llm_call" };
  const modelContext = { protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION };
  assert.equal(attachModelContext(context, modelContext), context);
  assert.equal(context.modelContext, modelContext);
  assert.equal(context.contextProtocolVersion, HOOK_PROTOCOL_VERSION);
});

test("attachModelContext explicitly supports hooks without an active model context", () => {
  const context = {};
  attachModelContext(context, null);
  assert.equal(context.modelContext, null);
});

test("attachModelContext rejects invalid hook targets", () => {
  for (const context of [undefined, null, false, 0, "", [], () => {}]) {
    assert.throws(() => attachModelContext(context, null), /hook context must be a plain object/);
  }
});

test("attachModelContext rejects invalid model contexts before mutating the hook", () => {
  for (const modelContext of [
    undefined,
    false,
    0,
    "",
    [],
    {},
    { protocolVersion: String(MODEL_CONTEXT_PROTOCOL_VERSION) },
    { protocolVersion: MODEL_CONTEXT_PROTOCOL_VERSION + 1 },
  ]) {
    const context = { point: "before_llm_call" };
    assert.throws(() => attachModelContext(context, modelContext), /hook modelContext must be/);
    assert.deepEqual(context, { point: "before_llm_call" });
  }
});
