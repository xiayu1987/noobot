/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { normalizeRuntimeModelSpec } from "@noobot/model-runtime";
import test from "node:test";
import assert from "node:assert/strict";
import { invokeWithToolsTurn } from "../../../src/runtime/turn/turn-executor.js";
import {
  createTestModelPort,
  createLoopTurnIdentity,
  prepareTestTurnExecution,
} from "./turn-runtime-test-helper.js";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
import { writeContextMessageMetadata } from "@noobot/context-protocol/message/codec";
import { createMessageUid } from "@noobot/context-protocol/message/message-identity";

const MODEL = normalizeRuntimeModelSpec({
  model: "gpt-4o",
  reasoning_effort: "medium",
  tool_reasoning_effort: "medium",
  reasoning_effort_options: ["low", "medium", "high"],
  reasoning_effort_parameter: "reasoning_effort",
});

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
  const system = writeContextMessageMetadata(
    { role: "system", content: "sys" },
    { messageUid: createMessageUid() },
  );
  const history = writeContextMessageMetadata(
    { role: "assistant", content: "history" },
    {
      messageUid: createMessageUid(),
      dialogProcessId: "d1",
    },
  );

  const current = writeContextMessageMetadata(
    { role: "user", content: "current" },
    {
      messageUid: createMessageUid(),
      dialogProcessId: "d2",
      turnScopeId: "t2",
    },
  );
  const modelState = {
    modelPort: createTestModelPort(llm),
    runtime: createTestRuntimeContext(),
    activeModelSpec: MODEL,
  };
  const loopState = {
    messageBlocks: {
      system: [system],
      history: [
        current,
        writeContextMessageMetadata(
          { role: "system", content: "misplaced" },
          { messageUid: createMessageUid() },
        ),
        history,
      ],
      incremental: [current],
    },
    tools: [{ name: "execute_script" }],
    dialogProcessId: "d2",
    maxTurns: 1,
  };
  prepareTestTurnExecution(
    modelState,
    loopState,
    createLoopTurnIdentity(loopState),
    "presentation-message-block-normalization",
  );
  await invokeWithToolsTurn({ modelState, loopState, turn: 1 });
  assert.deepEqual(
    captured.map((item) => `${item.role}:${item.content}`),
    ["system:sys", "assistant:history", "user:current"],
  );
});
