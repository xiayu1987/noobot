/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { transitionTurnLifecycle } from "../../../agent/src/system-core/session/entities/turn-lifecycle-entity.js";
import { TURN_EVENT } from "@noobot/shared/turn-lifecycle-protocol";
import { recoverTurnFinalize } from "../../ws/chat-websocket/finalize-recovery.js";
import { startServerWithWs, closeServer, callChatWs, stopChatWs } from "./chat-websocket-server.test-helpers.js";

function createAuthoritativeBot({ persistSummary = true, failureAt = "" } = {}) {
  let lifecycle = {};
  const committed = [];
  const commitInputs = [];
  let runCount = 0;
  const bot = {
    async applyTurnLifecycleEvent(input) {
      commitInputs.push(structuredClone(input));
      const result = transitionTurnLifecycle(lifecycle, input);
      if (result.applied) {
        lifecycle = result.lifecycle;
        committed.push(input.eventType);
      }
      return result;
    },
    async runSession({ sessionId, runConfig, eventListener }) {
      runCount += 1;
      if (failureAt === "action") throw Object.assign(new Error("agent initialization failed"), { code: "agent_init_failed" });
      eventListener.onEvent({
        event: "agent_lifecycle_state_changed",
        data: {
          state: "running",
          sessionId,
          turnScopeId: runConfig.turnScopeId,
          dialogProcessId: "dp-authoritative",
        },
      });
      if (failureAt === "processing") throw Object.assign(new Error("agent processing failed"), { code: "agent_processing_failed" });
      return {
        sessionId,
        dialogProcessId: "dp-authoritative",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
    async upsertTurnStatus(payload) {
      if (!persistSummary) return null;
      return {
        turnStatus: {
          version: 7,
          turnScopeId: payload.turnScopeId,
          dialogProcessId: payload.dialogProcessId,
          status: "completed",
          reason: "run_completed",
        },
      };
    },
  };
  return {
    bot,
    committed: () => [...committed],
    commitInputs: () => structuredClone(commitInputs),
    runCount: () => runCount,
    lifecycle: () => lifecycle,
  };
}

const payload = {
  userId: "u1",
  sessionId: "s-authoritative",
  message: "hello",
  turnScopeId: "turn-authoritative",
  commandId: "command-authoritative",
  config: { turnScopeId: "turn-authoritative" },
};

test("authoritative lifecycle follows accepted -> running -> processed -> summary completed", async () => {
  const authoritative = createAuthoritativeBot();
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.PROCESSING_COMPLETED,
      TURN_EVENT.COMPLETED,
    ]);
    const wireEvents = events
      .filter((item) => item?.event === "turn_lifecycle")
      .map((item) => item.data.eventType);
    assert.deepEqual(wireEvents, authoritative.committed());
    assert.equal(events.some((item) => item?.event === "done"), true);
    const turn = authoritative.lifecycle().turns[payload.turnScopeId];
    assert.equal(turn.state, "completed");
    assert.equal(turn.summaryVersion, 7);
    const inputs = authoritative.commitInputs();
    assert.equal(inputs[0].createSessionIfAbsent, true);
    assert.equal(inputs[0].action, "send");
    assert.equal(inputs.slice(1).some((input) => "createSessionIfAbsent" in input), false);
  } finally {
    await closeServer(server);
  }
});

test("rejected initial provision does not start Agent execution", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.applyTurnLifecycleEvent = async (input) => {
    assert.equal(input.eventType, TURN_EVENT.ACTION_ACCEPTED);
    assert.equal(input.createSessionIfAbsent, true);
    return { applied: false, reason: "session_identity_conflict" };
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-provision-rejected",
        turnScopeId: "turn-provision-rejected",
        commandId: "command-provision-rejected",
        config: { turnScopeId: "turn-provision-rejected" },
      },
    });
    assert.equal(authoritative.runCount(), 0);
    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(events.some((item) => item?.event === "error"), true);
  } finally {
    await closeServer(server);
  }
});

test("summary persistence failure never commits authoritative completed", async () => {
  const authoritative = createAuthoritativeBot({ persistSummary: false });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: {
      ...payload,
      sessionId: "s-summary-failure",
      turnScopeId: "turn-summary-failure",
      commandId: "command-summary-failure",
      config: { turnScopeId: "turn-summary-failure" },
    } });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.PROCESSING_COMPLETED,
      TURN_EVENT.FAILED,
    ]);
    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(
      events.filter((item) => item?.event === "turn_lifecycle")
        .some((item) => item?.data?.eventType === TURN_EVENT.COMPLETED),
      false,
    );
    assert.equal(authoritative.lifecycle().turns["turn-summary-failure"].state, "completion_failed");
  } finally {
    await closeServer(server);
  }
});

for (const [failureAt, expectedPhase] of [["action", "action"], ["processing", "processing"]]) {
  test(`authoritative failure before/after RUNNING is classified as ${expectedPhase}`, async () => {
    const authoritative = createAuthoritativeBot({ failureAt });
    const scopedPayload = {
      ...payload,
      sessionId: `s-${failureAt}-failure`,
      turnScopeId: `turn-${failureAt}-failure`,
      commandId: `command-${failureAt}-failure`,
      config: { turnScopeId: `turn-${failureAt}-failure` },
    };
    const server = await startServerWithWs({ bot: authoritative.bot });
    try {
      const events = await callChatWs({ port: server.address().port, payload: scopedPayload });
      const lifecycleEvents = events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data);
      assert.deepEqual(lifecycleEvents.map((item) => item.eventType), [
        TURN_EVENT.ACTION_ACCEPTED,
        ...(failureAt === "processing" ? [TURN_EVENT.PROCESSING_STARTED] : []),
        TURN_EVENT.FAILED,
      ]);
      const failed = lifecycleEvents.at(-1);
      assert.equal(failed.phase, expectedPhase);
      assert.equal(failed.failure.phase, expectedPhase);
      assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, `${expectedPhase}_failed`);
    } finally {
      await closeServer(server);
    }
  });
}

test("summary failure is classified as completion without authoritative completed", async () => {
  const authoritative = createAuthoritativeBot({ persistSummary: false });
  const scopedPayload = {
    ...payload,
    sessionId: "s-completion-failure",
    turnScopeId: "turn-completion-failure",
    commandId: "command-completion-failure",
    config: { turnScopeId: "turn-completion-failure" },
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({ port: server.address().port, payload: scopedPayload });
    const lifecycleEvents = events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data);
    assert.equal(lifecycleEvents.some((item) => item.eventType === TURN_EVENT.COMPLETED), false);
    const failed = lifecycleEvents.find((item) => item.eventType === TURN_EVENT.FAILED);
    assert.equal(failed?.phase, "completion");
    assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, "completion_failed");
  } finally {
    await closeServer(server);
  }
});

test("authoritative stop follows accepted -> stop processed -> stop summary completed", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.runSession = async ({ sessionId, runConfig, eventListener, abortSignal }) => {
    eventListener.onEvent({
      event: "agent_lifecycle_state_changed",
      data: {
        state: "running",
        sessionId,
        turnScopeId: runConfig.turnScopeId,
        dialogProcessId: "dp-stop-authoritative",
      },
    });
    await new Promise((resolve) => abortSignal.addEventListener("abort", resolve, { once: true }));
    const error = new Error("stopped");
    error.name = "AbortError";
    throw error;
  };
  authoritative.bot.persistStoppedAssistantMessage = async ({ partialAssistant }) => ({
    version: 9,
    sessionId: "s-stop-authoritative",
    turnScopeId: partialAssistant.turnScopeId,
    dialogProcessId: partialAssistant.dialogProcessId,
    status: "user_stopped",
    reason: "user_stop",
  });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await stopChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-stop-authoritative",
        turnScopeId: "turn-stop-authoritative",
        commandId: "command-stop-authoritative",
        config: { turnScopeId: "turn-stop-authoritative" },
      },
      stopPayload: {
        sessionId: "s-stop-authoritative",
        turnScopeId: "turn-stop-authoritative",
        commandId: "stop-command-authoritative",
        expectedRevision: 2,
        partialAssistant: {
          sessionId: "s-stop-authoritative",
          turnScopeId: "turn-stop-authoritative",
          dialogProcessId: "dp-stop-authoritative",
          content: "partial",
        },
      },
    });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.STOP_ACCEPTED,
      TURN_EVENT.STOP_PROCESSING_COMPLETED,
      TURN_EVENT.STOP_COMPLETED,
    ]);
    assert.deepEqual(
      events.filter((item) => item?.event === "turn_lifecycle").map((item) => item.data.eventType),
      authoritative.committed(),
    );
    const turn = authoritative.lifecycle().turns["turn-stop-authoritative"];
    assert.equal(turn.state, "stop_completed");
    assert.equal(turn.summaryVersion, 9);
    assert.equal(events.some((item) => item?.event === "user_stopped"), true);
  } finally {
    await closeServer(server);
  }
});

test("rejected stop has no abort or interaction side effects", async () => {
  let abortCount = 0;
  let rejectCount = 0;
  const sent = [];
  const { createMessageHandler } = await import("../../ws/chat-websocket/message-handler.js");
  const handler = createMessageHandler({
    state: { currentTurnScopeId: "turn-locked", currentRunMeta: { sessionId: "session-locked" } },
    authInfo: { userId: "u1" },
    webSocket: {},
    sendEvent: (event, data) => sent.push({ event, data }),
    translateText: (key) => key,
    normalizeLocale: (value) => value,
    normalizeRunConfig: (value) => value,
    isForbiddenUserScope: () => false,
    resolveBot: () => ({}),
    pendingInteractionRequests: new Map(),
    rejectAllPendingInteractions: () => { rejectCount += 1; },
    commitTurnLifecycle: async () => ({ applied: false, reason: "stop_not_allowed", currentRevision: 2 }),
  });
  // A registered execution handle would be aborted later in the accepted path;
  // rejection must return before either local side effect.
  const originalAbort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (...args) { abortCount += 1; return originalAbort.apply(this, args); };
  try {
    await handler(JSON.stringify({ action: "stop", sessionId: "session-locked", turnScopeId: "turn-locked" }));
  } finally {
    AbortController.prototype.abort = originalAbort;
  }
  assert.equal(rejectCount, 0);
  assert.equal(abortCount, 0);
  assert.equal(sent.at(-1)?.data?.errorCode, "stop_not_allowed");
});

test("finalize recovery is idempotent across repeated service recovery attempts", async () => {
  let lifecycle = {};
  const apply = (input) => {
    const result = transitionTurnLifecycle(lifecycle, input);
    lifecycle = result.lifecycle;
    return result;
  };
  apply({ turnScopeId: "turn-recover", commandId: "start", eventType: TURN_EVENT.ACTION_ACCEPTED, action: "send" });
  apply({ turnScopeId: "turn-recover", commandId: "running", eventType: TURN_EVENT.PROCESSING_STARTED, phase: "processing", executionState: "sending" });
  apply({ turnScopeId: "turn-recover", commandId: "processed", eventType: TURN_EVENT.PROCESSING_COMPLETED, phase: "completion", finalizeCommandId: "stable-finalize" });
  let summaryWrites = 0;
  const bot = {
    async getTurnLifecycleSnapshot({ commandId }) {
      const turn = lifecycle.turns["turn-recover"];
      return { found: true, snapshot: { commandId, activeTurn: lifecycle.activeTurnScopeId ? turn : null } };
    },
    async upsertTurnStatus() { summaryWrites += 1; return { turnStatus: { version: 4 } }; },
  };
  const commitTurnLifecycle = async (input) => apply(input);
  const request = { bot, commitTurnLifecycle, userId: "u1", sessionId: "s1", commandId: "recover" };
  const first = await recoverTurnFinalize(request);
  const second = await recoverTurnFinalize(request);
  assert.equal(first.recovered, true);
  assert.equal(second.recovered, false);
  assert.equal(second.reason, "no_recoverable_finalize");
  assert.equal(summaryWrites, 1);
  assert.equal(lifecycle.turns["turn-recover"].state, "completed");
  assert.equal(lifecycle.turns["turn-recover"].revision, 4);
  assert.equal(lifecycle.sequence, 4);
});
