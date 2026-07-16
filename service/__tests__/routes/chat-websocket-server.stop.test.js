import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startServerWithWs, closeServer, callChatWs, stopChatWs } from "./chat-websocket-server.test-helpers.js";

test("chat-websocket-server: stop persists and emits the user_stopped turnScopeId", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
        return {
          turnScopeId: payload?.turnScopeId,
          dialogProcessId: payload?.dialogProcessId,
          status: "user_stopped",
          reason: "user_stop",
          description: "用户停止了本轮生成",
        };
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

    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-new");
    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-new");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop emits non-terminal stopping before run settles", async () => {
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
      ws.on("open", () => {
        ws.send(JSON.stringify({
          userId: "u1",
          sessionId: "s1",
          message: "hello",
          turnScopeId: "turn-slow",
          config: { locale: "zh-CN" },
        }));
        setTimeout(() => ws.send(JSON.stringify({
          action: "stop",
          turnScopeId: "turn-slow",
          partialAssistant: {
            dialogProcessId: "dp-slow",
            turnScopeId: "turn-slow",
          },
        })), 10);
      });
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "channel_state" && parsed?.data?.state === "stopping") {
          resolve(parsed);
        }
        if (parsed?.event === "user_stopped" || parsed?.event === "done") {
          reject(new Error(`unexpected terminal event before run settled: ${parsed.event}`));
        }
      });
      ws.on("error", reject);
      setTimeout(() => reject(new Error("stopping event timeout")), 1000);
    });
    assert.equal(stoppingEvent?.data?.turnScopeId, "turn-slow");
    assert.equal(stoppingEvent?.data?.dialogProcessId, "dp-slow");
    resolveRun();
    ws.close();
  } finally {
    resolveRun?.();
    await closeServer(server);
  }
});

test("chat-websocket-server: stop request emits user_stopped even when runSession completes normally", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
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
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-normal-after-stop");
    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-normal-after-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-normal-after-stop");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stopped event and persistence backfill assistant identity from run result", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
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

    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-backfill");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-result-backfill");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.sessionId, "s-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.dialogProcessId, "dp-result-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.state, undefined);
    assert.equal(capturedStopPayload?.partialAssistant?.status, undefined);
    assert.equal(capturedStopPayload?.partialAssistant?.channelState, undefined);
    assert.equal(capturedStopPayload?.partialAssistant?.stopState, undefined);
    assert.deepEqual(stoppedEvent?.data?.turnStatus, {
      turnScopeId: "turn-backfill",
      dialogProcessId: "dp-result-backfill",
      parentDialogProcessId: "",
      status: "user_stopped",
      reason: "user_stop",
      description: "用户停止了本轮生成",
    });
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: non-user abort does not persist or emit user_stopped", async () => {
  let persistCalled = false;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async () => {
        persistCalled = true;
      },
      runSession: async () => {
        const error = new Error("upstream aborted unexpectedly");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s-non-user-abort",
        message: "hello",
        turnScopeId: "turn-non-user-abort",
        config: { locale: "zh-CN" },
      },
    });

    assert.equal(persistCalled, false);
    assert.equal(events.some((item) => item?.event === "user_stopped"), false);
    const errorEvent = events.find((item) => item?.event === "error");
    assert.match(String(errorEvent?.data?.error || ""), /upstream aborted unexpectedly/);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: forbidden user scope does not run or persist a turn status", async () => {
  let runCalls = 0;
  let turnStatusWrites = 0;
  const server = await startServerWithWs({
    bot: {
      runSession: async () => {
        runCalls += 1;
        return {};
      },
      upsertTurnStatus: async () => {
        turnStatusWrites += 1;
        return null;
      },
    },
    isForbiddenUserScope: () => true,
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "forbidden-user",
        sessionId: "s-forbidden",
        message: "hello",
        turnScopeId: "turn-forbidden",
        config: { locale: "zh-CN" },
      },
    });

    assert.equal(runCalls, 0);
    assert.equal(turnStatusWrites, 0);
    assert.equal(events.some((item) => item?.event === "done"), false);
    assert.equal(events.some((item) => item?.event === "error"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: idle stop persists an authoritative user_stopped terminal fact", async () => {
  let persistedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      runSession: async () => ({}),
      persistStoppedAssistantMessage: async (payload = {}) => {
        persistedStopPayload = payload;
        return {
          turnScopeId: payload?.partialAssistant?.turnScopeId || "",
          dialogProcessId: payload?.partialAssistant?.dialogProcessId || "",
          status: "user_stopped",
          reason: "user_stop",
          description: "用户停止了本轮生成",
        };
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
        reject(new Error("idle stop response timeout"));
      }, 1000);
      ws.on("open", () => {
        ws.send(JSON.stringify({
          action: "stop",
          turnScopeId: "turn-idle-stop",
          partialAssistant: {
            dialogProcessId: "dp-idle-stop",
            turnScopeId: "turn-idle-stop",
          },
        }));
      });
      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(String(raw || "{}"));
          messages.push(parsed);
          if (parsed?.event === "user_stopped") {
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

    const stoppingEvent = events.find((item) => item?.event === "channel_state" && item?.data?.state === "stopping");
    assert.equal(stoppingEvent?.data?.turnScopeId, "turn-idle-stop");
    assert.equal(stoppingEvent?.data?.dialogProcessId, "dp-idle-stop");
    assert.equal(stoppingEvent?.data?.sourceEvent, "stop_requested_idle_persisted");
    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-idle-stop");
    assert.equal(stoppedEvent?.data?.turnStatus?.status, "user_stopped");
    assert.equal(persistedStopPayload?.partialAssistant?.turnScopeId, "turn-idle-stop");
    assert.equal(events.some((item) => item?.event === "error"), false);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: pending stop is consumed by a later run with the same turnScopeId", async () => {
  let capturedStopPayload = null;
  let persistStopCalls = 0;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        persistStopCalls += 1;
        // Simulate the only case that should retain a pending stop: the idle
        // request could not persist an authoritative terminal fact. The later
        // run then consumes that pending stop and persists it successfully.
        if (persistStopCalls === 1) throw new Error("temporary persistence failure");
        capturedStopPayload = payload;
        return {
          turnScopeId: payload?.partialAssistant?.turnScopeId || "",
          dialogProcessId: payload?.partialAssistant?.dialogProcessId || "",
          status: "user_stopped",
          reason: "user_stop",
          description: "用户停止了本轮生成",
        };
      },
      runSession: async ({ abortSignal }) => {
        await new Promise((resolve) => {
          if (abortSignal?.aborted) return resolve();
          abortSignal?.addEventListener?.("abort", resolve, { once: true });
        });
        const error = new Error("aborted by pending stop");
        error.name = "AbortError";
        throw error;
      },
    },
  });
  try {
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
        headers: { authorization: "Bearer test-key" },
      });
      const timer = setTimeout(() => reject(new Error("pending stop ack timeout")), 1000);
      ws.on("open", () => ws.send(JSON.stringify({
        action: "stop",
        sessionId: "s-pending",
        turnScopeId: "turn-pending",
        partialAssistant: { dialogProcessId: "dp-pending", turnScopeId: "turn-pending" },
      })));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "channel_state" && parsed?.data?.state === "stopping") {
          clearTimeout(timer);
          ws.close(1000, "pending_stop_recorded");
          resolve();
        }
      });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });

    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s-pending",
        message: "hello",
        turnScopeId: "turn-pending",
        config: { locale: "zh-CN" },
      },
    });

    const stoppedEvent = events.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-pending");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-pending");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-pending");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-pending");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop from a new websocket aborts an active run by turnScopeId", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
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
        runWs.send(JSON.stringify({
          userId: "u1",
          sessionId: "s-cross-stop",
          message: "hello",
          turnScopeId: "turn-cross-stop",
          config: { locale: "zh-CN" },
        }));
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
      ws.on("open", () => ws.send(JSON.stringify({
        action: "stop",
        sessionId: "s-cross-stop",
        turnScopeId: "turn-cross-stop",
        partialAssistant: { content: "partial", turnScopeId: "turn-cross-stop" },
      })));
      ws.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        if (parsed?.event === "channel_state" && parsed?.data?.state === "stopping") {
          clearTimeout(timer);
          ws.close(1000, "stop_ack_received");
          resolve(parsed);
        }
      });
      ws.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    assert.equal(stopAck?.data?.sourceEvent, "stop_requested_registry");
    assert.equal(stopAck?.data?.turnScopeId, "turn-cross-stop");

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("active run stopped timeout")), 1000);
      runWs.on("message", (raw) => {
        const parsed = JSON.parse(String(raw || "{}"));
        runEvents.push(parsed);
        if (parsed?.event === "user_stopped") {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("close", () => {
        if (runEvents.some((item) => item?.event === "user_stopped")) {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const stoppedEvent = runEvents.find((item) => item?.event === "user_stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-cross-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-cross-stop");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-cross-stop");
  } finally {
    await closeServer(server);
  }
});

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
