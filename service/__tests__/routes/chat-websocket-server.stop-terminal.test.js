/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startServerWithWs, closeServer, stopChatWs, createProtocolTestCommand } from "./chat-websocket-server.test-helpers.js";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/event-protocol";
import { TURN_EVENT } from "@noobot/session-protocol";
import { transitionTurnLifecycle } from "@noobot/authoritative-state/domain";

test("chat-websocket-server: stop persists and emits authoritative stop completion identity", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      materializeTerminal: async ({ event, terminalStatus }) => {
        capturedStopPayload = { event, terminalStatus };
        return { summaryVersion: 1, turnStatus: {
          version: 1, turnScopeId: event.turnScopeId, dialogProcessId: event.dialogProcessId,
          status: "user_stopped", reason: "user_stop",
        } };
      },
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          if (abortSignal?.aborted) {
            resolve();
            return;
          }
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        const error = new Error("aborted by user");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await stopChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        turnScopeId: "turn-new",
        config: { locale: "zh-CN" },
      },
      stopPayload: {
        turnScopeId: "turn-new",
        partialAssistant: {
          content: "partial",
          dialogProcessId: "dp-new",
          turnScopeId: "turn-new",
        },
      },
    });

    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.turnScopeId, "turn-new");
    const stoppedEvent = events.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(stoppedEvent?.data?.sessionId, "s1");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-new");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-new");
    assert.equal(stoppedEvent?.data?.phase, "stop");
    assert.equal(stoppedEvent?.data?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.eventId);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop emits authoritative acceptance before run settles", async () => {
  let resolveRun = null;
  const runWait = new Promise((resolve) => {
    resolveRun = resolve;
  });
  const server = await startServerWithWs({
    bot: {
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          if (abortSignal?.aborted) {
            resolve();
            return;
          }
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        await runWait;
        return { sessionId: "s1", dialogProcessId: "dp-slow", answer: "" };
      },
    },
  });
  try {
    const { port } = server.address();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const stoppingEvent = await new Promise((resolve, reject) => {
      let stopSent = false;
      ws.on("open", () => {
        ws.send(JSON.stringify(createProtocolTestCommand({
          userId: "u1",
          sessionId: "s1",
          message: "hello",
          turnScopeId: "turn-slow",
          config: { locale: "zh-CN" },
        })));
      });
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (!stopSent && parsed?.event === "turn_lifecycle" && parsed?.data?.capabilities?.canStop === true) {
          stopSent = true;
          ws.send(JSON.stringify(createProtocolTestCommand({
            action: "stop",
            sessionId: "s1",
            turnScopeId: "turn-slow",
            expectedRevision: parsed.data.revision,
            partialAssistant: {
              dialogProcessId: "dp-slow",
              turnScopeId: "turn-slow",
            },
          })));
        }
        if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_ACCEPTED) {
          resolve(parsed);
        }
        if ((parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_COMPLETED) ||
            parsed?.event === "done") {
          reject(new Error(`unexpected terminal event before run settled: ${parsed.event}`));
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("stopping event timeout")), 1000);
    });
    assert.equal(stoppingEvent?.data?.turnScopeId, "turn-slow");
    assert.equal(stoppingEvent?.data?.dialogProcessId, "dp-slow");
    assert.equal(stoppingEvent?.data?.phase, "stop");
    resolveRun();
    ws.close();
  } finally {
    resolveRun?.();
    await closeServer(server);
  }
});

test("chat-websocket-server: stop request emits authoritative stop completion when runSession completes normally", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      materializeTerminal: async ({ event, terminalStatus }) => {
        capturedStopPayload = { event, terminalStatus };
        return { summaryVersion: 1, turnStatus: {
          version: 1, turnScopeId: event.turnScopeId, dialogProcessId: event.dialogProcessId,
          status: "user_stopped", reason: "user_stop",
        } };
      },
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        return {
          sessionId: "s1",
          dialogProcessId: "dp-normal-after-stop",
          answer: "completed",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await stopChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        turnScopeId: "turn-normal-after-stop",
        config: { locale: "zh-CN" },
      },
      stopPayload: {
        turnScopeId: "turn-normal-after-stop",
        partialAssistant: {
          dialogProcessId: "dp-normal-after-stop",
          turnScopeId: "turn-normal-after-stop",
        },
      },
    });

    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.turnScopeId, "turn-normal-after-stop");
    const stoppedEvent = events.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(stoppedEvent?.data?.sessionId, "s1");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-normal-after-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-normal-after-stop");
    assert.equal(stoppedEvent?.data?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.eventId);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: authoritative stop completion and persistence backfill assistant identity from run result", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      materializeTerminal: async ({ event, terminalStatus }) => {
        capturedStopPayload = { event, terminalStatus };
        return { summaryVersion: 1, turnStatus: {
          version: 1, turnScopeId: event.turnScopeId, dialogProcessId: event.dialogProcessId,
          status: "user_stopped", reason: "user_stop",
        } };
      },
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        return {
          sessionId: "s-backfill",
          dialogProcessId: "dp-result-backfill",
          answer: "ignored-after-stop",
          messages: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await stopChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s-backfill",
        message: "hello",
        turnScopeId: "turn-backfill",
        config: { locale: "zh-CN" },
      },
      stopPayload: {
        turnScopeId: "turn-backfill",
        partialAssistant: {
          content: "",
        },
      },
    });

    const stoppedEvent = events.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(stoppedEvent?.data?.sessionId, "s-backfill");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-result-backfill");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.sessionId, "s-backfill");
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.dialogProcessId, "dp-result-backfill");
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.state, undefined);
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.status, undefined);
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.channelState, undefined);
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.stopState, undefined);
    const authoritativeTerminal = events.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(authoritativeTerminal?.data?.state, "stop_completed");
    assert.equal(authoritativeTerminal?.data?.summaryVersion, 1);
    assert.equal(authoritativeTerminal?.data?.turnScopeId, "turn-backfill");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: idle stop persists an authoritative user_stopped terminal fact", async () => {
  let persistedStopPayload = null;
  let lifecycle = {};
  let authorityEventOutbox = [];
  let authorityEventSequence = 0;
  const lifecycleEvents = [];
  const persistStoppedTurn = async (payload = {}) => {
    persistedStopPayload = payload;
    return {
      version: 1,
      sessionId: payload.sessionId || "",
      turnScopeId: payload.turnScopeId || "",
      dialogProcessId: payload.dialogProcessId || "",
      parentDialogProcessId: payload.parentDialogProcessId || "",
      status: "user_stopped",
      reason: "user_stop",
      description: "用户停止了本轮生成",
    };
  };
  for (const event of [
    {
      turnScopeId: "turn-idle-stop",
      commandId: "turn-idle-stop",
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      messageId: "msg-event-idle-stop",
      presentationMessageId: "msg-idle-stop",
    },
    {
      turnScopeId: "turn-idle-stop",
      commandId: "turn-idle-stop:processing-started",
      eventType: "turn.processing_started",
      phase: "processing",
      executionState: "sending",
    },
  ]) {
    const seeded = transitionTurnLifecycle(lifecycle, event);
    assert.equal(seeded.applied, true);
    lifecycle = seeded.lifecycle;
  }
  const server = await startServerWithWs({
    bot: {
      runSession: async () => ({}),
      applyTurnLifecycleEvent: async (event = {}) => {
        lifecycleEvents.push(event);
        const terminalMaterialization = event.terminalStatus
          ? await persistStoppedTurn({
              sessionId: event.sessionId,
              turnScopeId: event.turnScopeId,
              dialogProcessId: event.dialogProcessId,
              parentDialogProcessId: event.parentDialogProcessId,
              partialAssistant: event.terminalStatus.assistantMessage || {},
            })
          : null;
        const result = commitTurnLifecycle({
          lifecycle,
          event,
          eventOutbox: authorityEventOutbox,
          createEventId: () => `idle-stop-authority-event-${++authorityEventSequence}`,
          materializeTerminal: event.terminalStatus
            ? () => ({
                summaryVersion: terminalMaterialization.version,
                turnStatus: terminalMaterialization,
              })
            : undefined,
        });
        if (result.applied) {
          lifecycle = result.lifecycle;
          authorityEventOutbox = result.eventOutbox;
        }
        return result;
      },
      getPendingAuthorityEvents: async () => ({
        found: true,
        events: listPendingAuthorityEvents(authorityEventOutbox),
      }),
      recordAuthorityEventAttempt: async ({ eventId } = {}) => {
        const result = recordAuthorityEventDeliveryAttempt(authorityEventOutbox, { eventId });
        if (result.found) authorityEventOutbox = result.outbox;
        return { recorded: result.found };
      },
      acknowledgeAuthorityEvent: async ({ eventId } = {}) => {
        const result = acknowledgeAuthorityEventDelivery(authorityEventOutbox, {
          eventId,
          deliveredAt: new Date().toISOString(),
        });
        if (result.found) authorityEventOutbox = result.outbox;
        return { acknowledged: result.found };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await new Promise((resolve, reject) => {
      const messages = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`idle stop response timeout: ${JSON.stringify(messages)}`));
      }, 1000);
      ws.on("open", () => {
        ws.send(JSON.stringify(createProtocolTestCommand({
          action: "stop",
          sessionId: "session-idle-stop",
          turnScopeId: "turn-idle-stop",
          expectedRevision: 2,
          partialAssistant: {
            dialogProcessId: "dp-idle-stop",
            turnScopeId: "turn-idle-stop",
          },
        })));
      });
      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(String(raw || "{}"));
          messages.push(parsed);
          if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_COMPLETED) {
            ws.close(1000, "idle_stop_persisted");
          }
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      });
      ws.on("close", () => {
        clearTimeout(timer);
        resolve(messages);
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    const wireLifecycleEvents = events
      .filter((item) => item?.event === "turn_lifecycle")
      .map((item) => item.data);
    assert.deepEqual(
      wireLifecycleEvents.map((item) => item.eventType),
      [TURN_EVENT.STOP_ACCEPTED, TURN_EVENT.STOP_PROCESSING_COMPLETED, TURN_EVENT.STOP_COMPLETED],
    );
    assert.equal(wireLifecycleEvents.every((item) => item.turnScopeId === "turn-idle-stop"), true);
    assert.equal(wireLifecycleEvents.every((item) => item.dialogProcessId === "dp-idle-stop"), true);
    assert.equal(events.some((item) => item?.event === "channel_state"), false);
    const authoritativeTerminal = wireLifecycleEvents.find((item) => item.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(authoritativeTerminal?.sessionId, "session-idle-stop");
    assert.equal(authoritativeTerminal?.turnScopeId, "turn-idle-stop");
    assert.equal(authoritativeTerminal?.dialogProcessId, "dp-idle-stop");
    assert.equal(authoritativeTerminal?.phase, "stop");
    assert.equal(authoritativeTerminal?.state, "stop_completed");
    assert.ok(authoritativeTerminal?.eventId);
    assert.equal(authoritativeTerminal?.summaryVersion, 1);
    assert.equal(persistedStopPayload?.partialAssistant?.turnScopeId, "turn-idle-stop");
    assert.equal(events.some((item) => item?.event === "error"), false);
    assert.deepEqual(
      lifecycleEvents.map((item) => item.eventType),
      ["turn.stop_accepted", "turn.stop_processing_completed", "turn.stop_completed"],
    );
    assert.equal(lifecycle.activeTurnScopeId, "");
    assert.equal(lifecycle.turns["turn-idle-stop"]?.state, "stop_completed");
    const nextAction = transitionTurnLifecycle(lifecycle, {
      turnScopeId: "turn-after-idle-stop",
      commandId: "turn-after-idle-stop",
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      messageId: "msg-event-after-idle-stop",
      presentationMessageId: "msg-after-idle-stop",
    });
    assert.equal(nextAction.applied, true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop without an authoritative Turn is rejected", async () => {
  const server = await startServerWithWs();
  try {
    const { port } = server.address();
    const events = await new Promise((resolve, reject) => {
      const messages = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      ws.on("open", () => ws.send(JSON.stringify(createProtocolTestCommand({
        action: "stop",
        sessionId: "s-without-turn",
        turnScopeId: "turn-without-authority",
      }))));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        messages.push(parsed);
        if (parsed?.event === "error") ws.close(1000, "stop_rejected");
      });
      ws.on("close", () => resolve(messages));
      ws.on("error", reject);
    });

    const errorEvent = events.find((item) => item?.event === "error");
    assert.equal(errorEvent?.data?.errorCode, "turn_message_identity_incomplete");
    assert.equal(events.some((item) => item?.event === "channel_state"), false);
  } finally {
    await closeServer(server);
  }
});
