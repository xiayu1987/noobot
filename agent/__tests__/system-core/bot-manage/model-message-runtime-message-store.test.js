/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { ModelMessageRuntimeHelpers } from "../../../src/system-core/bot-manage/session/model-message-runtime-helpers.js";
import { canonicalizeMessageStore } from "../../../src/system-core/agent/core/message-context/message-store.js";

test("ModelMessageRuntimeHelpers resolveModelMessages uses explicit block arrays only", () => {
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

  const resolved = resolver({ ctx });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys"],
  );
});

test("ModelMessageRuntimeHelpers ignores stray block id views", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const ctx = {
    messages: [],
    messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [{ role: "user", content: "hist", dialogProcessId: "d1" }],
      incremental: [{ role: "user", content: "cur", dialogProcessId: "d2" }],
    },
  };
  ctx.messages = [
    ...ctx.messageBlocks.system,
    ...ctx.messageBlocks.history,
    ...ctx.messageBlocks.incremental,
  ];
  canonicalizeMessageStore(ctx);
  ctx.messageBlocks.systemIds = ["stale-system-id"];
  ctx.messageBlocks.historyIds = ["stale-history-id"];
  ctx.messageBlocks.incrementalIds = ["stale-incremental-id"];

  const resolved = resolver({ ctx, purpose: "main_agent" });

  assert.deepEqual(
    resolved.map((item = {}) => `${item.role}:${item.content}`),
    ["system:sys", "user:hist", "user:cur"],
  );
});
