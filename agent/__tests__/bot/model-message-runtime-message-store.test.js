/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelContext } from "@noobot/context-protocol";
import { projectSessionRecordToContextMessage } from "@noobot/context-protocol/message/session-projection";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";

import { ModelMessageRuntimeHelpers } from "../../src/bot/session/model-message-runtime-helpers.js";

function sessionContextMessage(record) {
  return projectSessionRecordToContextMessage({ messageUid: createMessageUid(), ...record });
}

const agentContext = { bindings: { runtime: { eventListener: { onEvent() {} } }, tools: [] } };

test("ModelMessageRuntimeHelpers resolveModelMessages uses explicit block arrays only", () => {
  const helpers = new ModelMessageRuntimeHelpers();
  const resolver = helpers.createResolveModelMessages();
  const canonicalIncremental = sessionContextMessage({
    role: "assistant",
    content: "drop-by-id",
    summarized: true,
  });
  const ctx = {
    agentContext,
    modelContext: createModelContext({
      messageBlocks: {
        system: [sessionContextMessage({ role: "system", content: "sys" })],
        history: [],
        incremental: [canonicalIncremental],
      },
    }),
  };

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
    agentContext,
    modelContext: createModelContext({
      messageBlocks: {
        system: [sessionContextMessage({ role: "system", content: "sys" })],
        history: [sessionContextMessage({ role: "user", content: "hist", dialogProcessId: "d1" })],
        incremental: [
          sessionContextMessage({ role: "user", content: "cur", dialogProcessId: "d2" }),
        ],
      },
    }),
  };
  ctx.modelContext.messageBlocks.systemIds = ["stale-system-id"];
  ctx.modelContext.messageBlocks.historyIds = ["stale-history-id"];
  ctx.modelContext.messageBlocks.incrementalIds = ["stale-incremental-id"];

  const resolved = resolver({ ctx, purpose: "main_agent" });

  assert.deepEqual(
    resolved.map((item = {}) => `${item.role}:${item.content}`),
    ["system:sys", "user:hist", "user:cur"],
  );
});
