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
  waitForCondition,
} from "./chat-websocket-server.test-helpers.js";

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
      persistStoppedAssistantMessage: async () => {},
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
    assert.ok(stoppedEvents.some((item) => item?.event === "user_stopped"));

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
    const doneEvent = nextEvents.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.answer, "next ok");
    assert.equal(doneEvent?.data?.dialogProcessId, "dp-next-run");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: refreshed websocket rebinds active run tool increments", async () => {
  let emitAfterRefresh;
  let finishRun;
  let runCalls = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async ({ eventListener }) => {
        runCalls += 1;
        await new Promise((resolve) => { emitAfterRefresh = resolve; });
        eventListener.onEvent({
          event: "tool_call_start",
          data: {
            envelopeKind: "noobot.message_event", envelopeVersion: 2,
            eventId: "evt-refresh-tool", eventType: "tool_call_start",
            sessionId: "s-refresh", dialogProcessId: "dp-refresh",
            turnScopeId: "turn-refresh", sequence: 1,
            timestamp: new Date().toISOString(), messageId: "msg-refresh",
            presentationMessageId: "msg-refresh-presentation",
            toolCallId: "call-refresh", tool: "read_file", args: {},
          },
        });
        await new Promise((resolve) => { finishRun = resolve; });
        return { sessionId: "s-refresh", dialogProcessId: "dp-refresh", answer: "ok", messages: [] };
      },
    },
  });
  const sockets = [];
  try {
    const url = `ws://127.0.0.1:${server.address().port}/chat/ws`;
    const payload = { userId: "u1", sessionId: "s-refresh", message: "run", turnScopeId: "turn-refresh" };
    const oldWs = new WebSocket(url, { headers: { authorization: "Bearer test-key" } });
    sockets.push(oldWs);
    await new Promise((resolve, reject) => {
      oldWs.on("open", () => { oldWs.send(JSON.stringify(payload)); resolve(); });
      oldWs.on("error", reject);
    });
    await waitForCondition(() => Boolean(emitAfterRefresh), {
      message: "refresh run did not start",
    });

    const newWs = new WebSocket(url, { headers: { authorization: "Bearer test-key" } });
    sockets.push(newWs);
    const receivedFrames = [];
    let resolveRebound;
    const reboundFrame = new Promise((resolve) => { resolveRebound = resolve; });
    const toolFrame = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`rebound tool increment timeout: ${JSON.stringify(receivedFrames)}`)), 1000);
      newWs.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        receivedFrames.push(parsed);
        if (parsed?.data?.sourceEvent === "running_transport_rebound") resolveRebound(parsed);
        if (parsed?.data?.event?.eventType === "tool_call_start") { clearTimeout(timer); resolve(parsed); }
      });
      newWs.on("error", reject);
    });
    await new Promise((resolve, reject) => {
      newWs.on("open", () => { newWs.send(JSON.stringify(payload)); resolve(); });
      newWs.on("error", reject);
    });
    await reboundFrame;
    oldWs.close(1000, "refreshed");
    emitAfterRefresh();
    const received = await toolFrame;
    assert.equal(received.event, "message_event");
    assert.equal(received.data.event.eventType, "tool_call_start");
    assert.equal(runCalls, 1);
    finishRun();
  } finally {
    for (const socket of sockets) socket.close();
    await closeServer(server);
  }
});
