/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import {
  startServerWithWs,
  closeServer,
  callChatWs,
  stopChatWs,
  createProtocolTestCommand,
  waitForCondition,
} from "./chat-websocket-server.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";
import { EVENT_FAMILY } from "@noobot/event-protocol";
import {
  AGENT_COMMAND_RECEIPT_OUTCOME,
  AGENT_TRANSPORT_EVENT,
} from "@noobot/agent-transport-protocol";
import {
  MESSAGE_EVENT_SEQUENCE_DOMAIN,
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
} from "@noobot/event-protocol/message-event";

test("chat-websocket-server: stop closes run and next websocket run can start", async () => {
  let runCount = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async ({ abortSignal }) => {
        runCount += 1;
        if (runCount === 1) {
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
        }
        return {
          sessionId: "s1",
          dialogProcessId: "dp-next-run",
          answer: "next ok",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const stoppedEvents = await stopChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "stop me",
        turnScopeId: "turn-stop-before-next",
        config: { locale: "zh-CN" },
      },
      stopPayload: {
        turnScopeId: "turn-stop-before-next",
        partialAssistant: {
          dialogProcessId: "dp-stop-before-next",
          turnScopeId: "turn-stop-before-next",
        },
      },
    });
    const stoppedEvent = stoppedEvents.find((item) =>
      item?.event === "turn_lifecycle" &&
      item?.data?.payload?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(stoppedEvent?.data?.identity?.sessionId, "s1");
    assert.equal(stoppedEvent?.data?.identity?.turnScopeId, "turn-stop-before-next");
    assert.equal(stoppedEvent?.data?.payload?.dialogProcessId, "dp-stop-before-next");
    assert.equal(stoppedEvent?.data?.payload?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.identity?.eventId);

    const nextEvents = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "run again",
        turnScopeId: "turn-next-run",
        config: { locale: "zh-CN" },
      },
    });
    const completedEvent = nextEvents.find(
      (item) =>
        item?.event === "turn_lifecycle" &&
        item?.data?.payload?.eventType === TURN_EVENT.COMPLETED,
    );
    assert.equal(completedEvent?.data?.identity?.sessionId, "s1");
    assert.equal(completedEvent?.data?.payload?.dialogProcessId, "dp-next-run");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: refreshed websocket rebinds active run tool increments", async () => {
  let emitAfterRefresh;
  let finishRun;
  let runCalls = 0;
  let server;
  server = await startServerWithWs({
    resolveAuthByApiKey: () => ({ userId: "u1" }),
    bot: {
      runSession: async ({ eventListener }) => {
        runCalls += 1;
        await new Promise((resolve) => { emitAfterRefresh = resolve; });
        await new Promise((resolve) => setTimeout(resolve, 25));
        const envelope = await server.bot.commitTestAuthorityEvent({
          family: EVENT_FAMILY.MESSAGE_TIMELINE,
          identity: {
            eventId: "evt-refresh-tool",
            eventType: MESSAGE_EVENT_WIRE_EVENT,
            sessionId: "s-refresh",
            turnScopeId: "turn-refresh",
            messageId: "msg-refresh",
          },
          causality: { correlationId: "turn-refresh" },
          ordering: {
            domain: MESSAGE_EVENT_SEQUENCE_DOMAIN,
            scopeId: "msg-refresh",
            sequence: 1,
          },
          producer: { type: "agent", id: "test-agent" },
          payload: {
            eventType: MESSAGE_EVENT_TYPE.TOOL_CALL_START,
            presentationMessageId: "msg-refresh-presentation",
            toolCallId: "call-refresh",
            tool: "read_file",
            args: {},
          },
        });
        await eventListener.onEvent({
          event: "authority_event_committed",
          data: { envelope },
        });
        await new Promise((resolve) => { finishRun = resolve; });
        return { sessionId: "s-refresh", dialogProcessId: "dp-refresh", answer: "ok", messages: [] };
      },
    },
  });
  const sockets = [];
  try {
    const url = `ws://127.0.0.1:${server.address().port}/chat/ws`;
    const payload = {
      userId: "u1",
      sessionId: "s-refresh",
      message: "run",
      dialogProcessId: "dp-refresh",
      turnScopeId: "turn-refresh",
    };
    const oldWs = new WebSocket(url, { headers: { authorization: "Bearer test-key" } });
    sockets.push(oldWs);
    await new Promise((resolve, reject) => {
      oldWs.on("open", () => { oldWs.send(JSON.stringify(createProtocolTestCommand(payload))); resolve(); });
      oldWs.on("error", reject);
    });
    await waitForCondition(() => Boolean(emitAfterRefresh), {
      message: "refresh run did not start",
    });

    const newWs = new WebSocket(url, { headers: { authorization: "Bearer test-key" } });
    sockets.push(newWs);
    const receivedFrames = [];
    let resolveRebound;
    const reboundReceipt = new Promise((resolve) => { resolveRebound = resolve; });
    const toolFrame = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rebound tool increment timeout: runCalls=${runCalls} ${JSON.stringify(receivedFrames)}`)), 1000);
      newWs.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        receivedFrames.push(parsed);
        if (
          parsed?.event === AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT &&
          parsed?.data?.outcome === AGENT_COMMAND_RECEIPT_OUTCOME.REBOUND
        ) {
          resolveRebound(parsed);
        }
        if (parsed?.data?.payload?.eventType === MESSAGE_EVENT_TYPE.TOOL_CALL_START) {
          clearTimeout(timer);
          resolve(parsed);
        }
      });
      newWs.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      newWs.on("open", () => { newWs.send(JSON.stringify(createProtocolTestCommand(payload))); resolve(); });
      newWs.on("error", reject);
    });
    await reboundReceipt;
    emitAfterRefresh();
    const received = await toolFrame;
    assert.equal(received.event, MESSAGE_EVENT_WIRE_EVENT);
    assert.equal(received.data.payload.eventType, MESSAGE_EVENT_TYPE.TOOL_CALL_START);
    assert.equal(runCalls, 1);
    oldWs.close(1000, "refreshed");
    finishRun();
  } finally {
    for (const socket of sockets) socket.close();
    await closeServer(server);
  }
});
