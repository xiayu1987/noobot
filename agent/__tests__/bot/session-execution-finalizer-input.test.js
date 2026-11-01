/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SessionExecutionFinalizer } from "../../src/bot/execution/finalizer.js";
import { createTestSessionFinalizationContext } from "../helpers/session-finalization.js";
import { createNoopMemoryPostProcessService } from "../helpers/memory-postprocess-service.js";
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";

function setup() {
  const effects = [];
  const finalizer = new SessionExecutionFinalizer({
    session: {
      async upsertTurnTiming() {
        effects.push("timing");
      },
      async saveExecutionReport() {
        effects.push("report");
      },
      async getExecutionTurnLogs() {
        effects.push("logs");
        return [];
      },
    },
    turnPersister: {
      async appendAgentMessages({ messages }) {
        effects.push(messages);
      },
    },
    memoryPostProcessService: createNoopMemoryPostProcessService(),
    now: () => {
      effects.push("clock");
      return "2026-11-01T00:00:00.000Z";
    },
  });
  const payload = {
    ...createTestSessionFinalizationContext(),
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn-1",
    agentResult: createAgentTurnResult({
      output: "",
      traces: [],
      modelMessages: [],
      modelLoopRound: 0,
      turnMessages: [],
    }),
    persistedTurnMessageUids: [],
    persistedTurnMessages: [],
    durableTurnMessages: [],
    summaryCheckpointPromotionSources: [],
  };
  return { finalizer, payload, effects };
}

test("an explicit empty agent result completes without inventing a message", async () => {
  const { finalizer, payload, effects } = setup();
  const result = await finalizer.finalizeRunSession(payload);
  assert.deepEqual(result.messages, []);
  assert.equal(result.answer, "");
  assert.deepEqual(effects.find(Array.isArray), []);
  assert.ok(effects.includes("report"));
});

test("invalid agent results fail before persistence, clocks and lifecycle mutations", async () => {
  for (const messages of [
    undefined,
    null,
    {},
    [null],
    [{}],
    new Array(1),
    [{ messageUid: "mu1" }, { messageUid: "mu1" }],
  ]) {
    const { finalizer, payload, effects } = setup();
    payload.agentResult.turnMessages = messages;
    payload.lifecycle.enterPersisting = () => effects.push("persisting");
    const before = structuredClone(payload.agentResult);
    await assert.rejects(finalizer.finalizeRunSession(payload), {
      code: "AGENT_TURN_RESULT_INVALID",
    });
    assert.deepEqual(payload.agentResult, before);
    assert.deepEqual(effects, []);
  }
});
