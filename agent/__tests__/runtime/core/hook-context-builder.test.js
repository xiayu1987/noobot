/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createModelContext } from "@noobot/context-protocol/hook-context";
import { buildHookContext } from "../../../src/runtime/hooks/hook-context-builder.js";

test("before_final_output retains the supplied authoritative modelContext entity", () => {
  const modelContext = createModelContext({
    messageBlocks: {
      system: [],
      history: [{ role: "user", content: "history" }],
      incremental: [{ role: "assistant", content: "final" }],
    },
  });
  const context = buildHookContext("before_final_output", {}, {
    modelContext,
    messages: [{ role: "user", content: "must not become a second source" }],
    result: { output: "final" },
  });

  assert.equal(context.contextProtocolVersion, 1);
  assert.equal(context.modelContext, modelContext);
  assert.equal(Object.hasOwn(context, "messages"), false);
  assert.equal(Object.hasOwn(context, "messageBlocks"), false);
  assert.equal(Object.hasOwn(context, "messageStore"), false);
  assert.deepEqual(
    context.modelContext.messages.map((message) => message.content),
    ["history", "final"],
  );
});
