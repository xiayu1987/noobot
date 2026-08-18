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

test("socket close terminates an accepted turn and releases the session mutex", async () => {
  const authoritative = createAuthoritativeBot();
  authoritative.bot.runSession = async ({ abortSignal }) => {
    await new Promise((resolve) => abortSignal.addEventListener("abort", resolve, { once: true }));
    const error = new Error("socket closed");
    error.name = "AbortError";
    throw error;
  };
  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const scopedPayload = {
      ...payload,
      sessionId: "s-socket-close",
      turnScopeId: "turn-socket-close",
      commandId: "command-socket-close",
      config: { turnScopeId: "turn-socket-close" },
    };
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error("socket close lifecycle timeout"));
      }, 2000);
      ws.on("open", () => ws.send(JSON.stringify(createProtocolTestCommand(scopedPayload))));
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw || "{}"));
        if (
          message?.event === "turn_lifecycle" &&
          message?.data?.payload?.eventType === TURN_EVENT.ACTION_ACCEPTED
        ) {
          ws.close(1000, "restart");
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const deadline = Date.now() + 1000;
    while (authoritative.lifecycle().activeTurnScopeId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(authoritative.committed(), [TURN_EVENT.ACTION_ACCEPTED, TURN_EVENT.FAILED]);
    assert.equal(authoritative.lifecycle().activeTurnScopeId, "");
    assert.equal(authoritative.lifecycle().turns[scopedPayload.turnScopeId].state, "action_failed");
  } finally {
    await closeServer(server);
  }
});

test("a new action recovers a stale persisted turn lost after service restart", async () => {
  const authoritative = createAuthoritativeBot();
  await authoritative.bot.applyTurnLifecycleEvent({
    sessionId: "s-before-restart",
    turnScopeId: "turn-before-restart",
    messageId: "turn-message-before-restart",
    presentationMessageId: "presentation-before-restart",
    dialogProcessId: "dialog-before-restart",
    commandId: "command-before-restart",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: "action",
    action: "send",
  });
  await authoritative.bot.applyTurnLifecycleEvent({
    sessionId: "s-before-restart",
    turnScopeId: "turn-before-restart",
    dialogProcessId: "dialog-before-restart",
    commandId: "command-before-restart:processing-started",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: "processing",
    executionState: "sending",
  });
  authoritative.lifecycle().turns["turn-before-restart"].updatedAt = new Date(
    Date.now() - TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs - 1,
  ).toISOString();

  const server = await startServerWithWs({ bot: authoritative.bot });
  try {
    const events = await callChatWs({
      port: server.address().port,
      payload: {
        ...payload,
        sessionId: "s-after-restart",
        turnScopeId: "turn-after-restart",
        commandId: "command-after-restart",
        config: { turnScopeId: "turn-after-restart" },
      },
    });

    assert.equal(authoritative.lifecycle().turns["turn-before-restart"].state, "processing_failed");
    assert.equal(authoritative.lifecycle().turns["turn-after-restart"].state, "completed");
    assert.equal(
      events.some(
        (item) =>
          item?.event === "turn_lifecycle" &&
          item?.data?.payload?.eventType === TURN_EVENT.COMPLETED,
      ),
      true,
    );
    const orphanFailure = authoritative
      .commitInputs()
      .find(
        (input) =>
          input.eventType === TURN_EVENT.FAILED && input.turnScopeId === "turn-before-restart",
      );
    assert.equal(orphanFailure?.failure?.code, "service_restart_orphaned_turn");
  } finally {
    await closeServer(server);
  }
});

test("snapshot reconnect recovers a stale persisted turn lost after service restart", async () => {
  const authoritative = createAuthoritativeBot();
  installLifecycleSnapshotReader(authoritative);
  await authoritative.bot.applyTurnLifecycleEvent({
    userId: "u1",
    sessionId: "s-snapshot-restart",
    turnScopeId: "turn-snapshot-restart",
    messageId: "message-snapshot-restart",
    presentationMessageId: "presentation-snapshot-restart",
    dialogProcessId: "dialog-snapshot-restart",
    commandId: "command-snapshot-restart",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
  });
  await authoritative.bot.applyTurnLifecycleEvent({
    userId: "u1",
    sessionId: "s-snapshot-restart",
    turnScopeId: "turn-snapshot-restart",
    dialogProcessId: "dialog-snapshot-restart",
    commandId: "command-snapshot-restart:processing",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: TURN_PHASE.PROCESSING,
    executionState: "sending",
  });
  authoritative.lifecycle().turns["turn-snapshot-restart"].updatedAt = new Date(
    Date.now() - TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs - 1,
  ).toISOString();

  const server = await startServerWithWs({
    bot: authoritative.bot,
    resolveAuthByApiKey: () => ({ userId: "u1" }),
  });
  try {
    const first = await requestTurnSnapshot({
      port: server.address().port,
      sessionId: "s-snapshot-restart",
      commandId: "snapshot-restart-1",
    });
    assert.equal(first.payload.activeTurn, null);
    assert.equal(first.payload.activeTurnScopeId, "");
    assert.equal(first.payload.recentTerminalTurns[0]?.turnScopeId, "turn-snapshot-restart");
    assert.equal(first.payload.recentTerminalTurns[0]?.state, TURN_STATE.PROCESSING_FAILED);
    assert.equal(first.payload.recentTerminalTurns[0]?.failure?.code, "service_restart_orphaned_turn");

    const second = await requestTurnSnapshot({
      port: server.address().port,
      sessionId: "s-snapshot-restart",
      commandId: "snapshot-restart-2",
    });
    assert.equal(second.payload.activeTurn, null);
    assert.equal(
      authoritative
        .commitInputs()
        .filter(
          (input) =>
            input.eventType === TURN_EVENT.FAILED && input.turnScopeId === "turn-snapshot-restart",
        ).length,
      1,
    );
  } finally {
    await closeServer(server);
  }
});

test("snapshot reconnect does not terminate a matching live execution", async () => {
  const authoritative = createAuthoritativeBot();
  installLifecycleSnapshotReader(authoritative);
  await authoritative.bot.applyTurnLifecycleEvent({
    userId: "u1",
    sessionId: "s-live-snapshot",
    turnScopeId: "turn-live-snapshot",
    messageId: "message-live-snapshot",
    presentationMessageId: "presentation-live-snapshot",
    dialogProcessId: "dialog-live-snapshot",
    commandId: "command-live-snapshot",
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
  });
  await authoritative.bot.applyTurnLifecycleEvent({
    userId: "u1",
    sessionId: "s-live-snapshot",
    turnScopeId: "turn-live-snapshot",
    dialogProcessId: "dialog-live-snapshot",
    commandId: "command-live-snapshot:processing",
    eventType: TURN_EVENT.PROCESSING_STARTED,
    phase: TURN_PHASE.PROCESSING,
    executionState: "sending",
  });
  authoritative.lifecycle().turns["turn-live-snapshot"].updatedAt = new Date(
    Date.now() - TIME_THRESHOLDS.service.orphanedTurnRecoveryGraceMs - 1,
  ).toISOString();
  const liveHandle = registerActiveRun({
    userId: "u1",
    sessionId: "s-live-snapshot",
    turnScopeId: "turn-live-snapshot",
    dialogProcessId: "dialog-live-snapshot",
  });

  const server = await startServerWithWs({
    bot: authoritative.bot,
    resolveAuthByApiKey: () => ({ userId: "u1" }),
  });
  try {
    const snapshot = await requestTurnSnapshot({
      port: server.address().port,
      sessionId: "s-live-snapshot",
      commandId: "snapshot-live",
    });
    assert.equal(snapshot.payload.activeTurn?.turnScopeId, "turn-live-snapshot");
    assert.equal(snapshot.payload.activeTurn?.state, TURN_STATE.PROCESSING);
    assert.equal(
      authoritative.commitInputs().some((input) => input.eventType === TURN_EVENT.FAILED),
      false,
    );
  } finally {
    unregisterActiveRun(liveHandle);
    await closeServer(server);
  }
});

