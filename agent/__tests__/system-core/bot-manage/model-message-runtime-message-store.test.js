/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ModelMessageRuntimeHelpers } from "../../../src/system-core/bot-manage/session/model-message-runtime-helpers.js";
import { canonicalizeMessageStore } from "../../../src/system-core/agent/core/message-context/message-store.js";

test("ModelMessageRuntimeHelpers resolveModelMessages materializes canonical block ids", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const canonicalIncremental = { role: "assistant", content: "drop-by-id", summarized: true };
  const ctx = {
    messages: [{ role: "system", content: "sys" }, canonicalIncremental],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [],
      incremental: [canonicalIncremental],
    },
  };
  canonicalizeMessageStore(ctx);
  const staleCopy = { role: "assistant", content: "drop-by-id" };
  ctx.messageBlocks.incremental = [staleCopy];

  const resolved = resolver({ ctx });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys"],
  );
  assert.equal(staleCopy.summarized, undefined);
});
