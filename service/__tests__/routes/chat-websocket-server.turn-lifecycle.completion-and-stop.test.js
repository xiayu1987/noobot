/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";
import {
  commitTurnLifecycle,
  createAuthoritativeTurnSnapshot,
} from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import {
  createTurnLifecycleEnvelope,
  TURN_EVENT,
  TURN_LIFECYCLE_WIRE_EVENT,
  TURN_COMMAND,
  TURN_PHASE,
  TURN_STATE,
  SESSION_ERROR_CODE,
} from "@noobot/session-protocol";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";
import { recoverTurnFinalize } from "../../ws/chat-websocket/finalize-recovery.js";
import { createTurnLifecycleBridge } from "../../ws/chat-websocket/turn-lifecycle-bridge.js";
import { createAuthorityEventDispatcher } from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createRunEventListener } from "../../ws/chat-websocket/run-event-listener.js";
import {
  attachRunTransport,
  publishRunEvent,
  registerActiveRun,
  unregisterActiveRun,
} from "../../ws/chat-websocket/run-registry.js";
import { EXECUTION_QUERY_COMMAND } from "@noobot/session-protocol/execution-lifecycle";
import {
  startServerWithWs,
  closeServer,
  callChatWs,
  stopChatWs,
  createProtocolTestCommand,
} from "./chat-websocket-server.test-helpers.js";

import {
  createTestLifecycleEnvelope,
  createAuthoritativeBot,
  payload,
  installLifecycleSnapshotReader,
  requestTurnSnapshot,
} from "./chat-websocket-server.turn-lifecycle.fixtures.js";

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
    const lifecycleEvents = events
      .filter((item) => item?.event === "turn_lifecycle")
      .map((item) => item.data);
    assert.equal(
      lifecycleEvents.some((item) => item.eventType === TURN_EVENT.COMPLETED),
      false,
    );
    const failed = lifecycleEvents.find((item) => item.eventType === TURN_EVENT.FAILED);
    assert.equal(failed?.phase, "completion");
    assert.equal(
      authoritative.lifecycle().turns[scopedPayload.turnScopeId].state,
      "completion_failed",
    );
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
  authoritative.bot.materializeTerminal = async ({ event }) => ({
    summaryVersion: 9,
    turnStatus: {
      version: 9,
      sessionId: "s-stop-authoritative",
      turnScopeId: event.turnScopeId,
      dialogProcessId: event.dialogProcessId,
      status: "user_stopped",
      reason: "user_stop",
    },
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
    const stoppedEvent = events.find(
      (item) =>
        item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED,
    );
    assert.equal(stoppedEvent?.data?.sessionId, "s-stop-authoritative");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-stop-authoritative");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-stop-authoritative");
    assert.equal(stoppedEvent?.data?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.eventId);
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
    webSocket: { close() {} },
    sendEvent: (event, data) => sent.push({ event, data }),
    translateText: (key) => key,
    normalizeLocale: (value) => value,
    resolveBot: () => ({}),
    pendingInteractionRequests: new Map(),
    rejectAllPendingInteractions: () => {
      rejectCount += 1;
    },
    commitTurnLifecycle: async () => ({
      applied: false,
      reason: "stop_not_allowed",
      currentRevision: 2,
    }),
  });
  const originalAbort = AbortController.prototype.abort;
  AbortController.prototype.abort = function (...args) {
    abortCount += 1;
    return originalAbort.apply(this, args);
  };
  try {
    await handler(
      JSON.stringify(
        createProtocolTestCommand({
          action: "stop",
          sessionId: "session-locked",
          turnScopeId: "turn-locked",
        }),
      ),
    );
  } finally {
    AbortController.prototype.abort = originalAbort;
  }
  assert.equal(rejectCount, 0);
  assert.equal(abortCount, 0);
  assert.equal(sent.at(-1)?.data?.errorCode, "stop_not_allowed");
});

