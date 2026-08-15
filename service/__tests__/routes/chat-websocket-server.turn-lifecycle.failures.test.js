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

test("processing-start persistence rejection is observed while Agent execution is still active", async () => {
  const authoritative = createAuthoritativeBot();
  const applyLifecycle = authoritative.bot.applyTurnLifecycleEvent;
  authoritative.bot.applyTurnLifecycleEvent = async (input) => {
    if (input.eventType === TURN_EVENT.PROCESSING_STARTED) {
      return { applied: false, reason: "session_not_found" };
    }
    return applyLifecycle(input);
  };
  authoritative.bot.runSession = async ({ sessionId, runConfig, eventListener }) => {
    eventListener.onEvent({
      event: "agent_lifecycle_state_changed",
      data: {
        state: "running",
        sessionId,
        turnScopeId: runConfig.turnScopeId,
        dialogProcessId: "dp-processing-rejected",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { sessionId, dialogProcessId: "dp-processing-rejected", messages: [] };
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-processing-rejected",
        turnScopeId: "turn-processing-rejected",
        commandId: "command-processing-rejected",
        config: { turnScopeId: "turn-processing-rejected" },
      },
    });
    assert.equal(
      events.some((item) => item?.event === "error"),
      true,
    );
    assert.equal(server.server.listening, true);
  } finally {
    await closeServer(server);
  }
});

test("message listener boundary contains failures raised by terminal error persistence", async () => {
  const authoritative = createAuthoritativeBot({ failureAt: "action" });
  authoritative.bot.materializeTerminal = async () => {
    throw new Error("terminal_status_storage_failed");
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-terminal-boundary",
        turnScopeId: "turn-terminal-boundary",
        commandId: "command-terminal-boundary",
        config: { turnScopeId: "turn-terminal-boundary" },
      },
    });
    assert.equal(
      events.some((item) => item?.event === "error"),
      true,
    );
    assert.equal(server.server.listening, true);
  } finally {
    await closeServer(server);
  }
});

test("summary persistence failure never commits authoritative completed", async () => {
  const authoritative = createAuthoritativeBot({ persistSummary: false });
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-summary-failure",
        turnScopeId: "turn-summary-failure",
        commandId: "command-summary-failure",
        config: { turnScopeId: "turn-summary-failure" },
      },
    });
    assert.deepEqual(authoritative.committed(), [
      TURN_EVENT.ACTION_ACCEPTED,
      TURN_EVENT.PROCESSING_STARTED,
      TURN_EVENT.PROCESSING_COMPLETED,
      TURN_EVENT.FAILED,
    ]);
    assert.equal(
      events.some((item) => item?.event === "done"),
      false,
    );
    assert.equal(
      events
        .filter((item) => item?.event === "turn_lifecycle")
        .some((item) => item?.data?.eventType === TURN_EVENT.COMPLETED),
      false,
    );
    assert.equal(
      authoritative.lifecycle().turns["turn-summary-failure"].state,
      "completion_failed",
    );
  } finally {
    await closeServer(server);
  }
});

for (const [failureAt, expectedPhase] of [
  ["action", "action"],
  ["processing", "processing"],
]) {
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
      const lifecycleEvents = events
        .filter((item) => item?.event === "turn_lifecycle")
        .map((item) => item.data);
      assert.deepEqual(
        lifecycleEvents.map((item) => item.eventType),
        [
          TURN_EVENT.ACTION_ACCEPTED,
          ...(failureAt === "processing" ? [TURN_EVENT.PROCESSING_STARTED] : []),
          TURN_EVENT.FAILED,
        ],
      );
      const failed = lifecycleEvents.at(-1);
      assert.equal(failed.phase, expectedPhase);
      assert.equal(failed.failure.phase, expectedPhase);
      assert.equal(
        authoritative.lifecycle().turns[scopedPayload.turnScopeId].state,
        `${expectedPhase}_failed`,
      );
    } finally {
      await closeServer(server);
    }
  });
}

