import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  recordServiceWebSocketRuntimeError,
  recordServiceWebSocketSendFailure,
  registerChatWebSocketServer,
} from "../../ws/chat-websocket-server.js";

async function startServerWithWs({ runSession = async () => ({}), bot = null, sessionLogConfig = undefined } = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });

  const registered = registerChatWebSocketServer(server, {
    getBot: () => bot || ({ runSession }),
    resolveRequestLocale: () => "zh-CN",
    resolveAuthByApiKey: () => ({ userId: "primary-user" }),
    isForbiddenUserScope: () => false,
    normalizeRunConfig: (config = {}) => config || {},
    normalizeLocale: (locale = "") => String(locale || "zh-CN"),
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
    sessionLogConfig,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    registered,
    address: (...args) => server.address(...args),
  };
}

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForFile(filePath, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

async function closeServer(serverHandle) {
  const server = serverHandle?.server || serverHandle;
  const registered = serverHandle?.registered || null;
  for (const client of registered?.webSocketServer?.clients || []) {
    client.terminate?.();
  }
  registered?.webSocketServer?.close?.();
  await new Promise((resolve) => server.close(resolve));
}

async function callChatWs({ port, payload = {} } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    ws.on("open", () => ws.send(JSON.stringify(payload)));
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw || "{}")));
      } catch (error) {
        reject(error);
      }
    });
    ws.on("close", () => resolve(messages));
    ws.on("error", reject);
  });
}

async function stopChatWs({ port, payload = {}, stopPayload = {} } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
      setTimeout(() => ws.send(JSON.stringify({ action: "stop", ...stopPayload })), 10);
    });
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw || "{}")));
      } catch (error) {
        reject(error);
      }
    });
    ws.on("close", () => resolve(messages));
    ws.on("error", reject);
  });
}

async function requestRawUpgrade({ port, pathName = "/chat/ws" } = {}) {
  return new Promise((resolve, reject) => {
    let response = "";
    const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
      socket.write([
        `GET ${pathName} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Authorization: Bearer test-key",
        "",
        "",
      ].join("\r\n"));
    });
    socket.setTimeout(1000, () => {
      socket.destroy(new Error("raw upgrade response timeout"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(response));
    socket.on("close", () => resolve(response));
    socket.on("error", reject);
  });
}

test("chat-websocket-server: stop persists and emits the stopped turnScopeId", async () => {
  let capturedStopPayload = null;
  const server = await startServerWithWs({
    bot: {
      persistStoppedAssistantMessage: async (payload = {}) => {
        capturedStopPayload = payload;
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
    const stoppedEvent = events.find((item) => item?.event === "stopped");
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
        if (parsed?.event === "stopped" || parsed?.event === "done") {
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

test("chat-websocket-server: stop request emits stopped even when runSession completes normally", async () => {
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
    const stoppedEvent = events.find((item) => item?.event === "stopped");
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

    const stoppedEvent = events.find((item) => item?.event === "stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-backfill");
    assert.equal(stoppedEvent?.data?.dialogProcessId, "dp-result-backfill");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.sessionId, "s-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.dialogProcessId, "dp-result-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-backfill");
    assert.equal(capturedStopPayload?.partialAssistant?.state, "stopped");
    assert.equal(capturedStopPayload?.partialAssistant?.channelState, "stopped");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: idle stop request records pending stop without faking stopped", async () => {
  const server = await startServerWithWs();
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
          if (parsed?.event === "channel_state" && parsed?.data?.state === "stopping") {
            ws.close(1000, "pending_stop_recorded");
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
    assert.equal(stoppingEvent?.data?.sourceEvent, "stop_requested_pending");
    assert.equal(events.some((item) => item?.event === "stopped"), false);
    assert.equal(events.some((item) => item?.event === "error"), false);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: pending stop is consumed by a later run with the same turnScopeId", async () => {
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

    const stoppedEvent = events.find((item) => item?.event === "stopped");
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
        if (parsed?.event === "stopped") {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("close", () => {
        if (runEvents.some((item) => item?.event === "stopped")) {
          clearTimeout(timer);
          resolve();
        }
      });
      runWs.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const stoppedEvent = runEvents.find((item) => item?.event === "stopped");
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
    assert.ok(stoppedEvents.some((item) => item?.event === "stopped"));

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

test("chat-websocket-server: streaming=false 仍推系统事件且不推 delta", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: { tool: "mock_tool", args: { a: 1 }, dialogProcessId: "dp-1" },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "delta-token", dialogProcessId: "dp-1" },
      });
      eventListener?.onEvent?.({
        event: "tool_call_end",
        data: { tool: "mock_tool", result: "ok", dialogProcessId: "dp-1" },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: false, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("thinking"), true);
    assert.equal(names.includes("delta"), false);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: attachment and delta events keep request turnScopeId", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "attachments_saved",
        data: {
          dialogProcessId: "dp-attachments",
          sessionId: "sub-session-from-parser",
          attachments: [{ id: "att-1", name: "a.txt" }],
        },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "root-token", dialogProcessId: "dp-root" },
      });
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: {
          text: "sub-token",
          dialogProcessId: "dp-subagent",
          sessionId: "sub-session-1",
          subAgentSessionId: "sub-session-1",
          subAgentCall: true,
        },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-root",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        turnScopeId: "turn-parent",
        config: { streaming: true, locale: "zh-CN" },
      },
    });

    const attachmentsEvent = events.find((item) => item?.event === "attachments");
    assert.equal(attachmentsEvent?.data?.sessionId, "s1");
    assert.equal(attachmentsEvent?.data?.turnScopeId, "turn-parent");
    assert.deepEqual(attachmentsEvent?.data?.attachments, [{ id: "att-1", name: "a.txt" }]);

    const deltaEvent = events.find((item) => item?.event === "delta");
    assert.equal(deltaEvent?.data?.turnScopeId, "turn-parent");

    const subagentDeltaEvent = events.find(
      (item) => item?.event === "thinking" && item?.data?.rawEvent === "subagent_llm_delta",
    );
    assert.equal(subagentDeltaEvent?.data?.sessionId, "s1");
    assert.equal(subagentDeltaEvent?.data?.dialogProcessId, "dp-root");
    assert.equal(subagentDeltaEvent?.data?.childSessionId, "sub-session-1");
    assert.equal(subagentDeltaEvent?.data?.childDialogProcessId, "dp-subagent");
    assert.equal(subagentDeltaEvent?.data?.conversationStateOwner, "parent_agent");
    assert.equal(subagentDeltaEvent?.data?.turnScopeId, "turn-parent");

    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.turnScopeId, "turn-parent");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: child run system events are owned by parent dialog state", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: {
          dialogProcessId: "dp-parent",
          sessionId: "s1",
          tool: "process_content_task",
        },
      });
      eventListener?.onEvent?.({
        event: "session_starting",
        data: {
          dialogProcessId: "dp-child",
          sessionId: "child-session-1",
          parentSessionId: "s1",
        },
      });
      eventListener?.onEvent?.({
        event: "workspace_ready",
        data: {
          dialogProcessId: "dp-child",
          sessionId: "child-session-1",
          parentSessionId: "s1",
        },
      });
      eventListener?.onEvent?.({
        event: "tool_call_start",
        data: {
          dialogProcessId: "dp-child",
          parentDialogProcessId: "dp-parent",
          sessionId: "child-session-1",
          parentSessionId: "s1",
          tool: "parse_attachment",
        },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-parent",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: true, locale: "zh-CN" },
      },
    });

    const childSystemEvents = events.filter(
      (item) =>
        item?.event === "thinking" &&
        item?.data?.childSessionId === "child-session-1" &&
        ["session_starting", "workspace_ready", "tool_call_start"].includes(item?.data?.rawEvent),
    );
    assert.equal(childSystemEvents.length, 3);
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.dialogProcessId),
      ["dp-parent", "dp-parent", "dp-parent"],
    );
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.childDialogProcessId),
      ["dp-child", "dp-child", "dp-child"],
    );
    assert.deepEqual(
      childSystemEvents.map((item) => item?.data?.childSessionId),
      ["child-session-1", "child-session-1", "child-session-1"],
    );
    assert.equal(
      childSystemEvents.every(
        (item) =>
          item?.data?.subAgentCall === true &&
          item?.data?.conversationStateOwner === "parent_agent",
      ),
      true,
    );
    assert.equal(
      events.some((item) => item?.event === "thinking" && item?.data?.dialogProcessId === "dp-child"),
      false,
    );
    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.dialogProcessId, "dp-parent");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: streaming=true 保持 delta 推送", async () => {
  const server = await startServerWithWs({
    runSession: async ({ eventListener }) => {
      eventListener?.onEvent?.({
        event: "llm_delta",
        data: { text: "delta-token", dialogProcessId: "dp-1" },
      });
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: true, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), true);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: global streaming=true should allow delta", async () => {
  const server = await startServerWithWs({
    bot: {
      globalConfig: { streaming: true },
      runSession: async ({ eventListener }) => {
        eventListener?.onEvent?.({
          event: "llm_delta",
          data: { text: "delta-token", dialogProcessId: "dp-1" },
        });
        return {
          sessionId: "s1",
          dialogProcessId: "dp-1",
          answer: "done",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), true);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});


test("chat-websocket-server: explicit streaming=false should override global streaming=true", async () => {
  const server = await startServerWithWs({
    bot: {
      globalConfig: { streaming: true },
      runSession: async ({ eventListener }) => {
        eventListener?.onEvent?.({
          event: "llm_delta",
          data: { text: "delta-token", dialogProcessId: "dp-1" },
        });
        return {
          sessionId: "s1",
          dialogProcessId: "dp-1",
          answer: "done",
          messages: [],
          traces: [],
          executionLogs: [],
        };
      },
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        config: { streaming: false, locale: "zh-CN" },
      },
    });
    const names = events.map((item) => String(item?.event || ""));
    assert.equal(names.includes("delta"), false);
    assert.equal(names.includes("done"), true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: edit resend turnScopeId reaches runConfig", async () => {
  let capturedPayload = null;
  const server = await startServerWithWs({
    runSession: async (payload) => {
      capturedPayload = payload;
      return {
        sessionId: "s1",
        dialogProcessId: "dp-1",
        answer: "done",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    await callChatWs({
      port,
      payload: {
        userId: "u1",
        sessionId: "s1",
        message: "全仓回归测试",
        turnScopeId: " client-turn:resend ",
        config: { locale: "zh-CN", reuseExistingUserTurn: true },
      },
    });

    assert.equal(capturedPayload?.runConfig?.turnScopeId, "client-turn:resend");
    assert.equal(capturedPayload?.runConfig?.reuseExistingUserTurn, true);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action passes stopped snapshot identity and emits sending", async () => {
  let capturedPayload = null;
  const server = await startServerWithWs({
    runSession: async (payload) => {
      capturedPayload = payload;
      return {
        sessionId: "s1",
        dialogProcessId: "dp-new",
        answer: "continued",
        messages: [],
        traces: [],
        executionLogs: [],
      };
    },
  });
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s1",
        message: "continue",
        turnScopeId: "turn-new",
        config: {
          locale: "zh-CN",
          resumeDialogProcessId: "dp-stopped",
          resumeTurnScopeId: "turn-stopped",
          selectedModel: "main",
        },
      },
    });

    assert.equal(capturedPayload?.runConfig?.resumeFromStoppedSnapshot, true);
    assert.equal(capturedPayload?.runConfig?.resumeDialogProcessId, "dp-stopped");
    assert.equal(capturedPayload?.runConfig?.resumeTurnScopeId, "turn-stopped");
    assert.equal(capturedPayload?.runConfig?.turnScopeId, "turn-new");
    const sendingEvent = events.find((item) => item?.event === "channel_state" && item?.data?.state === "sending");
    assert.equal(sendingEvent?.data?.sourceEvent, "continue_started");
    assert.equal(sendingEvent?.data?.dialogProcessId, "dp-stopped");
    assert.equal(sendingEvent?.data?.turnScopeId, "turn-new");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: continue action requires stopped dialogProcessId and turnScopeId", async () => {
  const server = await startServerWithWs();
  try {
    const { port } = server.address();
    const events = await callChatWs({
      port,
      payload: {
        action: "continue",
        userId: "u1",
        sessionId: "s1",
        message: "continue",
        turnScopeId: "turn-new",
        config: { locale: "zh-CN" },
      },
    });
    const errorEvent = events.find((item) => item?.event === "error");
    assert.match(String(errorEvent?.data?.error || ""), /continue requires dialogProcessId and turnScopeId/);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: stop during continue request keeps stopping and ends stopped", async () => {
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
        const error = new Error("continue aborted");
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
        action: "continue",
        userId: "u1",
        sessionId: "s-continue-stop",
        dialogProcessId: "dp-stopped",
        message: "continue",
        turnScopeId: "turn-new",
        config: { locale: "zh-CN", resumeTurnScopeId: "turn-stopped" },
      },
      stopPayload: {
        sessionId: "s-continue-stop",
        turnScopeId: "turn-new",
        dialogProcessId: "dp-stopped",
        partialAssistant: { content: "partial", dialogProcessId: "dp-new", turnScopeId: "turn-new" },
      },
    });

    assert.equal(events.some((item) => item?.event === "channel_state" && item?.data?.state === "stopping"), true);
    const stoppedEvent = events.find((item) => item?.event === "stopped");
    assert.equal(stoppedEvent?.data?.sessionId, "s-continue-stop");
    assert.equal(stoppedEvent?.data?.turnScopeId, "turn-new");
    assert.equal(capturedStopPayload?.partialAssistant?.turnScopeId, "turn-new");
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: invalid upgrade URL writes sanitized system runtime event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-chat-ws-system-"));
  const server = await startServerWithWs({ sessionLogConfig: { workspaceRoot } });
  try {
    const { port } = server.address();
    const response = await requestRawUpgrade({
      port,
      pathName: "http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value",
    });

    assert.match(response, /^HTTP\/1\.1 400 /);

    const eventFile = path.join(
      workspaceRoot,
      "system",
      "runtime",
      "events",
      "system",
      "service",
      "transport.jsonl",
    );
    await waitForFile(eventFile);
    const [record] = await readJsonl(eventFile);
    assert.equal(record.scope, "system");
    assert.equal(record.source, "service");
    assert.equal(record.channel, "direct");
    assert.equal(record.category, "transport");
    assert.equal(record.level, "warn");
    assert.equal(record.event, "service.websocket.upgradeUrlParse.failed");
    assert.equal(Object.prototype.hasOwnProperty.call(record, "sessionId"), false);
    assert.equal(record.data.urlPathPreview, "http://[");
    assert.equal(record.data.urlLength, "http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value".length);
    assert.equal(record.error.name, "TypeError");
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("SECRET"), false);
    assert.equal(serialized.includes("Bearer-token"), false);
    assert.equal(serialized.includes("cookie=session"), false);
    assert.equal(serialized.includes("secret=value"), false);
  } finally {
    await closeServer(server);
  }
});

test("chat-websocket-server: service websocket send failures write direct system runtime event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-telemetry-"));
  await recordServiceWebSocketSendFailure({
    sessionLogConfig: { workspaceRoot },
    eventName: "done",
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    error: new Error("send failed"),
  });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "u1",
    "runtime",
    "session",
    "s1",
    "events",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "service");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].event, "service.websocket.sendEvent.failed");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].sessionId, "s1");
  assert.equal(records[0].dialogProcessId, "dp1");
  assert.equal(records[0].turnScopeId, "turn1");
  assert.equal(records[0].data.eventName, "done");
  assert.equal(records[0].data.error, "send failed");
});

test("chat-websocket-server: service websocket runtime errors write direct system runtime event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-runtime-telemetry-"));
  await recordServiceWebSocketRuntimeError({
    sessionLogConfig: { workspaceRoot },
    event: "service.websocket.run.failed",
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "p1",
    dialogProcessId: "dp1",
    turnScopeId: "turn1",
    error: new Error("run failed"),
    data: { phase: "run" },
  });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "u1",
    "runtime",
    "session",
    "s1",
    "events",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "service");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].event, "service.websocket.run.failed");
  assert.equal(records[0].userId, "u1");
  assert.equal(records[0].sessionId, "s1");
  assert.equal(records[0].parentSessionId, "p1");
  assert.equal(records[0].dialogProcessId, "dp1");
  assert.equal(records[0].turnScopeId, "turn1");
  assert.equal(records[0].data.phase, "run");
  assert.equal(records[0].data.error, "run failed");
});
