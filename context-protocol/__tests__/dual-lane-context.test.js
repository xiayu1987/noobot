/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createModelContext } from "../src/assembly/hook-context.js";
import { buildDualLaneModelContext, MODEL_CONTEXT_LANE } from "../src/assembly/dual-lane.js";

test("primary lane materializes the authoritative model context blocks", () => {
  const modelContext = createModelContext({
    messageBlocks: {
      system: [{ role: "system", content: "base system" }],
      history: [],
      incremental: [{ role: "user", content: "current task" }],
    },
  });
  const result = buildDualLaneModelContext({ lane: MODEL_CONTEXT_LANE.PRIMARY, modelContext });
  assert.deepEqual(
    result.messages.map((message) => message.content),
    ["base system", "current task"],
  );
});

test("primary lane applies its declared runtime projection and history limit", () => {
  const modelContext = createModelContext({
    messageBlocks: {
      system: [{ role: "system", content: "base system" }],
      history: [
        { role: "user", content: "old", dialogProcessId: "d1" },
        { role: "assistant", content: "old answer", dialogProcessId: "d1" },
        { role: "user", content: "latest", dialogProcessId: "d2" },
        { role: "assistant", content: "latest answer", dialogProcessId: "d2" },
      ],
      incremental: [],
    },
  });
  const result = buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.PRIMARY,
    modelContext,
    projectPrimaryMessage: (message) => ({ ...message, projected: true }),
    primaryHistoryLimit: 1,
  });
  assert.deepEqual(
    result.messageBlocks.history.map((message) => message.content),
    ["latest", "latest answer"],
  );
  assert.equal(
    result.messages.every((message) => message.projected === true),
    true,
  );
});

test("auxiliary lane keeps all system messages before history and task", () => {
  const result = buildDualLaneModelContext({
    lane: MODEL_CONTEXT_LANE.AUXILIARY,
    sourceMessages: [
      { role: "user", content: "history user" },
      { role: "system", content: "base system" },
      { role: "assistant", content: "history assistant" },
    ],
    protocolSystemMessages: ["planning protocol", "available tools"],
    taskMessages: [{ role: "user", content: "current planning task" }],
  });
  assert.deepEqual(
    result.messages.map((message) => `${message.role}:${message.content}`),
    [
      "system:base system",
      "system:planning protocol",
      "system:available tools",
      "user:history user",
      "assistant:history assistant",
      "user:current planning task",
    ],
  );
  assert.deepEqual(result.messages, [
    ...result.messageBlocks.system,
    ...result.messageBlocks.history,
    ...result.messageBlocks.incremental,
  ]);
});

test("auxiliary lane rejects role crossover between protocol blocks", () => {
  assert.throws(
    () =>
      buildDualLaneModelContext({
        lane: MODEL_CONTEXT_LANE.AUXILIARY,
        protocolSystemMessages: [{ role: "user", content: "wrong block" }],
      }),
    /accepts only system messages/,
  );
  assert.throws(
    () =>
      buildDualLaneModelContext({
        lane: MODEL_CONTEXT_LANE.AUXILIARY,
        taskMessages: [{ role: "system", content: "wrong block" }],
      }),
    /cannot contain system messages/,
  );
});
