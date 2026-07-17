/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { AgentRuntimeFacade } from "../../../../../src/system-core/agent/core/runtime/agent-runtime-facade.js";

test("AgentRuntimeFacade prepareTurnExecution builds context and runtime context", async () => {
  const calls = [];
  const facade = new AgentRuntimeFacade({
    contextFactory: {
      async buildAgentContext(payload = {}) {
        calls.push(["buildAgentContext", payload]);
        return { id: "agent_ctx", payload };
      },
      buildRunTurnAgentContext(agentContext = {}, abortSignal = null) {
        calls.push(["buildRunTurnAgentContext", { agentContext, abortSignal }]);
        return { id: "runtime_ctx", agentContext, abortSignal };
      },
    },
  });

  const abortSignal = { aborted: false };
  const result = await facade.prepareTurnExecution({
    buildContextPayload: { sessionId: "s1", inputAttachmentMetas: [{ attachmentId: "att1" }] },
    abortSignal,
  });

  assert.equal(result?.agentContext?.id, "agent_ctx");
  assert.equal(result?.runtimeAgentContext?.id, "runtime_ctx");
  assert.equal(calls[0]?.[0], "buildAgentContext");
  assert.deepEqual(calls[0]?.[1]?.inputAttachmentMetas, [{ attachmentId: "att1" }]);
  assert.equal(calls[1]?.[0], "buildRunTurnAgentContext");
  assert.equal(calls[1]?.[1]?.abortSignal, abortSignal);
});

test("AgentRuntimeFacade prepareTurnExecution forwards context build error", async () => {
  const facade = new AgentRuntimeFacade({
    contextFactory: {
      async buildAgentContext() {
        throw new Error("context build failed");
      },
      buildRunTurnAgentContext(agentContext = {}) {
        return agentContext;
      },
    },
  });

  await assert.rejects(
    () =>
      facade.prepareTurnExecution({
        buildContextPayload: { sessionId: "s1" },
        abortSignal: null,
      }),
    /context build failed/,
  );
});

test("AgentRuntimeFacade runTurn forwards payload to turn runner", async () => {
  const calls = [];
  const facade = new AgentRuntimeFacade({
    contextFactory: null,
    turnRunner: async (payload = {}) => {
      calls.push(payload);
      return { ok: true };
    },
  });
  const result = await facade.runTurn({
    agentContext: { id: "ctx" },
    userMessage: "hello",
    errorLogger: { log() {} },
  });
  assert.equal(result?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.userMessage, "hello");
});
