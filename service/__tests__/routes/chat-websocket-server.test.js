import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
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

  registerChatWebSocketServer(server, {
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
  return server;
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

async function closeServer(server) {
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
    assert.equal(subagentDeltaEvent?.data?.turnScopeId, "turn-parent");

    const doneEvent = events.find((item) => item?.event === "done");
    assert.equal(doneEvent?.data?.turnScopeId, "turn-parent");
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

test("chat-websocket-server: invalid upgrade URL writes sanitized system runtime event", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-chat-ws-system-"));
  const server = await startServerWithWs({ sessionLogConfig: { workspaceRoot } });
  try {
    const { port } = server.address();
    const response = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value`, {
        headers: { authorization: "Bearer test-key" },
      });
      socket.on("unexpected-response", (_request, res) => {
        resolve({ statusCode: res.statusCode });
      });
      socket.on("open", () => reject(new Error("unexpected websocket open")));
      socket.on("error", (error) => {
        if (error?.message?.includes?.("Unexpected server response")) return;
        reject(error);
      });
    });

    assert.equal(response.statusCode, 400);

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
    assert.equal(record.data.urlPathPreview, "/http://[");
    assert.equal(record.data.urlLength, "/http://[?apikey=SECRET&authorization=Bearer-token&cookie=session&secret=value".length);
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
