/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";

import { ModelMessageRuntimeHelpers } from "../../src/bot/session/model-message-runtime-helpers.js";

test("ModelMessageRuntimeHelpers resolveModelMessages uses explicit block arrays only", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const canonicalIncremental = { role: "assistant", content: "drop-by-id", summarized: true };
  const ctx = { modelContext: createModelContext({ messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [],
      incremental: [canonicalIncremental],
    },
  }) };

  const resolved = resolver({ ctx });

  assert.deepEqual(
    resolved.map((item = {}) => item.content),
    ["sys"],
  );
});

test("ModelMessageRuntimeHelpers ignores stray block id views", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const ctx = { modelContext: createModelContext({ messageBlocks: {
      system: [{ role: "system", content: "sys" }],
      history: [{ role: "user", content: "hist", dialogProcessId: "d1" }],
      incremental: [{ role: "user", content: "cur", dialogProcessId: "d2" }],
    },
  }) };
  ctx.modelContext.messageBlocks.systemIds = ["stale-system-id"];
  ctx.modelContext.messageBlocks.historyIds = ["stale-history-id"];
  ctx.modelContext.messageBlocks.incrementalIds = ["stale-incremental-id"];

  const resolved = resolver({ ctx, purpose: "main_agent" });

  assert.deepEqual(
    resolved.map((item = {}) => `${item.role}:${item.content}`),
    ["system:sys", "user:hist", "user:cur"],
  );
});
