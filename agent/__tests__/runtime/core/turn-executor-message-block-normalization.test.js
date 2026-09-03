/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { invokeWithToolsTurn } from "../../../src/runtime/turn/turn-executor.js";
import { createTestModelPort, prepareTestTurnExecution } from "./turn-runtime-test-helper.js";

const MODEL = {
  model: "gpt-4o",
  reasoning_effort: "medium",
  tool_reasoning_effort: "medium",
  reasoning_effort_options: ["low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
};

test("invokeWithToolsTurn normalizes dirty blocks before llm invoke", async () => {
  let captured = [];
  const llm = {
    bindTools: () => ({
      async invoke(messages) {
        captured = messages;
        return { content: "ok", tool_calls: [], additional_kwargs: {}, response_metadata: {} };
      },
    }),
  };
  const system = { role: "system", content: "sys" };
  const history = { role: "assistant", content: "history", dialogProcessId: "d1" };
  const current = { role: "user", content: "current", dialogProcessId: "d2", turnScopeId: "t2" };
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime: { systemRuntime: {} },
    defaultModelSpec: MODEL,
  };
  const loopState = {
    messages: [current, { role: "system", content: "misplaced" }, history, system, current],
    messageBlocks: {
      system: [system],
      history: [current, { role: "system", content: "misplaced" }, history],
      incremental: [current],
    },
    tools: [{ name: "execute_script" }],
    dialogProcessId: "d2",
    maxTurns: 1,
  };
  prepareTestTurnExecution(modelState, loopState, "block-normalization");
  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  assert.deepEqual(
    captured.map((item) => `${item.role}:${item.content}`),
    ["system:sys", "assistant:history", "user:current"],
  );
});
