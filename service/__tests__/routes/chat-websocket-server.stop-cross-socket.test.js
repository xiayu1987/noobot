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
  createProtocolTestCommand,
  waitForCondition,
} from "./chat-websocket-server.test-helpers.js";
import { TURN_EVENT } from "@noobot/session-protocol";

test("chat-websocket-server: stop from a new websocket aborts an active run by turnScopeId", async () => {
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
          if (abortSignal?.aborted) return resolve();
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        const error = new Error("aborted by cross websocket stop");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    const runEvents = [];
    const runWs = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    await new Promise((resolve, reject) => {
      runWs.on("open", () => {
        runWs.send(JSON.stringify(createProtocolTestCommand({
          userId: "u1",
          sessionId: "s-cross-stop",
          message: "hello",
          turnScopeId: "turn-cross-stop",
          config: { locale: "zh-CN" },
        })));
        resolve();
      });
      runWs.on("error", reject);
    });
    runWs.on("message", (raw) => runEvents.push(JSON.parse(String(raw || "{}"))));

    const stopAck = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      const timer = setTimeout(() => reject(new Error("cross websocket stop ack timeout")), 1000);
      ws.on("open", () => ws.send(JSON.stringify(createProtocolTestCommand({
        action: "stop",
        sessionId: "s-cross-stop",
        turnScopeId: "turn-cross-stop",
        expectedRevision: 2,
        partialAssistant: { content: "partial", turnScopeId: "turn-cross-stop" },
      }))));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_ACCEPTED) {
          clearTimeout(timer);
          ws.close(1000, "stop_ack_received");
          resolve(parsed);
        }
      });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    assert.equal(stopAck?.data?.phase, "stop");
    assert.equal(stopAck?.data?.turnScopeId, "turn-cross-stop");

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("active run stopped timeout")), 1000);
      runWs.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        runEvents.push(parsed);
        if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_COMPLETED) {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("close", () => {
        if (runEvents.some((item) =>
          item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED)) {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const stoppedEvent = runEvents.find((item) =>
      item?.event === "turn_lifecycle" && item?.data?.eventType === TURN_EVENT.STOP_COMPLETED);
    assert.equal(stoppedEvent?.data?.sessionId, "s-cross-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-cross-stop");
    assert.equal(stoppedEvent?.data?.state, "stop_completed");
    assert.ok(stoppedEvent?.data?.eventId);
    assert.equal(capturedStopPayload?.terminalStatus?.assistantMessage?.turnScopeId, "turn-cross-stop");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: an authenticated owner cannot stop another owner's identical turn", async () => {
  let activeRunAborted = false;
  let releaseActiveRun;
  const server = await startServerWithWs({
    resolveAuthByApiKey: (request) => ({
      userId: request.headers.authorization === "Bearer owner-a-key" ? "owner-a" : "owner-b",
    }),
    bot: {
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          releaseActiveRun = resolve;
          abortSignal?.addEventListener?.("abort", () => {
            activeRunAborted = true;
            resolve();
          }, { once: true });
        });
        if (activeRunAborted) {
          const error = new Error("owner-a run aborted");
          error.name = "AbortError";
          throw error;
        }
        return {
          sessionId: "s-owner-isolation",
          dialogProcessId: "dp-owner-isolation",
          answer: "owner-a completed",
          messages: [],
        };
      },
    },
  });
  const sockets = [];
  try {
    const url = `ws://127.0.0.1:${server.address().port}/chat/ws`;
    const runWs = new WebSocket(url, { headers: { authorization: "Bearer owner-a-key" } });
    sockets.push(runWs);
    await new Promise((resolve, reject) => {
      runWs.on("open", () => {
        runWs.send(JSON.stringify(createProtocolTestCommand({
          userId: "shared-workspace",
          sessionId: "s-owner-isolation",
          message: "run",
          turnScopeId: "turn-owner-isolation",
        })));
        resolve();
      });
      runWs.on("error", reject);
    });
    await waitForCondition(() => Boolean(releaseActiveRun), {
      message: "owner isolation run did not start",
    });

    const foreignStop = new WebSocket(url, { headers: { authorization: "Bearer owner-b-key" } });
    sockets.push(foreignStop);
    const stopState = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("foreign owner stop ack timeout")), 1000);
      foreignStop.on("open", () => foreignStop.send(JSON.stringify(createProtocolTestCommand({
        action: "stop",
        sessionId: "s-owner-isolation",
        turnScopeId: "turn-owner-isolation",
        expectedRevision: 2,
        partialAssistant: {
          dialogProcessId: "dp-owner-isolation",
          turnScopeId: "turn-owner-isolation",
        },
      }))));
      foreignStop.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_ACCEPTED) {
          clearTimeout(timer);
          resolve(parsed);
        }
      });
      foreignStop.on("error", (error) => { clearTimeout(timer); reject(error); });
    });

    assert.equal(stopState?.data?.phase, "stop");
    assert.equal(stopState?.data?.turnScopeId, "turn-owner-isolation");
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(activeRunAborted, false);
    releaseActiveRun();
  } finally {
    releaseActiveRun?.();
    for (const socket of sockets) socket.close();
    await closeServer(server);
  }
});

test("chat-websocket-server: the same authenticated owner stops its run without repeating workspace userId", async () => {
  let aborted = false;
  const server = await startServerWithWs({
    resolveAuthByApiKey: () => ({ userId: "canonical-owner" }),
    bot: {
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          if (abortSignal?.aborted) return resolve();
          abortSignal?.addEventListener?.("abort", () => {
            aborted = true;
            resolve();
          }, { once: true });
        });
        const error = new Error("stopped by canonical owner");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  const sockets = [];
  try {
    const url = `ws://127.0.0.1:${server.address().port}/chat/ws`;
    const runWs = new WebSocket(url, { headers: { authorization: "Bearer same-owner-run" } });
    sockets.push(runWs);
    await new Promise((resolve, reject) => {
      runWs.on("open", () => {
        runWs.send(JSON.stringify(createProtocolTestCommand({
          userId: "workspace-user",
          sessionId: "s-owner-stop",
          message: "run",
          turnScopeId: "turn-owner-stop",
        })));
        resolve();
      });
      runWs.on("error", reject);
    });

    const stopWs = new WebSocket(url, { headers: { authorization: "Bearer same-owner-stop" } });
    sockets.push(stopWs);
    const stopState = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("same owner stop ack timeout")), 1000);
      stopWs.on("open", () => stopWs.send(JSON.stringify(createProtocolTestCommand({
        action: "stop",
        sessionId: "s-owner-stop",
        turnScopeId: "turn-owner-stop",
        expectedRevision: 2,
        partialAssistant: {
          dialogProcessId: "dp-owner-stop",
          turnScopeId: "turn-owner-stop",
        },
      }))));
      stopWs.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "turn_lifecycle" && parsed?.data?.eventType === TURN_EVENT.STOP_ACCEPTED) {
          clearTimeout(timer);
          resolve(parsed);
        }
      });
      stopWs.on("error", (error) => { clearTimeout(timer); reject(error); });
    });

    assert.equal(stopState?.data?.phase, "stop");
    assert.equal(stopState?.data?.turnScopeId, "turn-owner-stop");
    const deadline = Date.now() + 1000;
    while (!aborted && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(aborted, true);
  } finally {
    for (const socket of sockets) socket.close();
    await closeServer(server);
  }
});
