/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { AgentRuntimeFacade } from "../../../../src/runtime/facade/agent-runtime-facade.js";

function createContextFactory({ buildAgentContextFromBuilder, calls = [] } = {}) {
  return {
    buildAgentContextFromBuilder:
      buildAgentContextFromBuilder ||
      (async (payload) => {
        calls.push(["buildAgentContextFromBuilder", payload]);
        return { id: "agent_ctx", payload };
      }),
    buildRunTurnAgentContext(agentContext, abortSignal) {
      calls.push(["buildRunTurnAgentContext", { agentContext, abortSignal }]);
      return { id: "runtime_ctx", agentContext, abortSignal };
    },
  };
}

const noopTurnRunner = async () => ({ ok: true });

test("AgentRuntimeFacade prepareTurnExecution builds context from the payload contextBuilder", async () => {
  const calls = [];
  const contextBuilder = { kind: "context-builder" };
  const facade = new AgentRuntimeFacade({
    contextFactory: createContextFactory({ calls }),
    turnRunner: noopTurnRunner,
  });

  const abortSignal = { aborted: false };
  const result = await facade.prepareTurnExecution({
    buildContextPayload: { mode: "conversation", sessionId: "s1", contextBuilder },
    abortSignal,
  });

  assert.equal(result.agentContext.id, "agent_ctx");
  assert.equal(result.runtimeAgentContext.id, "runtime_ctx");
  assert.equal(calls[0][0], "buildAgentContextFromBuilder");
  assert.equal(calls[0][1].contextBuilder, contextBuilder);
  assert.equal(calls[0][1].sessionId, "s1");
  assert.equal(calls[1][0], "buildRunTurnAgentContext");
  assert.equal(calls[1][1].abortSignal, abortSignal);
});

test("AgentRuntimeFacade prepareTurnExecution forwards context build error", async () => {
  const facade = new AgentRuntimeFacade({
    contextFactory: createContextFactory({
      buildAgentContextFromBuilder: async () => {
        throw new Error("context build failed");
      },
    }),
    turnRunner: noopTurnRunner,
  });

  await assert.rejects(
    () =>
      facade.prepareTurnExecution({
        buildContextPayload: { sessionId: "s1", contextBuilder: {} },
        abortSignal: null,
      }),
    /context build failed/,
  );
});

test("AgentRuntimeFacade rejects missing context factory or turn runner", () => {
  assert.throws(
    () => new AgentRuntimeFacade({ contextFactory: null, turnRunner: noopTurnRunner }),
    /contextFactory\.buildAgentContextFromBuilder/,
  );
  assert.throws(
    () => new AgentRuntimeFacade({ contextFactory: createContextFactory() }),
    /requires turnRunner/,
  );
});

test("AgentRuntimeFacade runTurn forwards payload to turn runner", async () => {
  const calls = [];
  const facade = new AgentRuntimeFacade({
    contextFactory: createContextFactory(),
    turnRunner: async (payload) => {
      calls.push(payload);
      return { ok: true };
    },
  });
  const result = await facade.runTurn({
    agentContext: { id: "ctx" },
    currentUserMessage: { content: "hello" },
    errorLogger: { log() {} },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].currentUserMessage.content, "hello");
});
