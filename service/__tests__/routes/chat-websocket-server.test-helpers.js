/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import { registerChatWebSocketServer } from "../../ws/chat-websocket-server.js";
import { commitTurnLifecycle } from "@noobot/authoritative-state/application";
import {
  acknowledgeAuthorityEventDelivery,
  listPendingAuthorityEvents,
  recordAuthorityEventDeliveryAttempt,
} from "@noobot/authoritative-state/contracts";

export async function startServerWithWs({
  runSession = async () => ({}),
  bot = null,
  initialTurnLifecycle = {},
  sessionLogConfig = undefined,
  resolveAuthByApiKey = () => ({ userId: "primary-user" }),
  isForbiddenUserScope = () => false,
} = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });

  const suppliedBot = bot || { runSession };
  let turnLifecycle = structuredClone(initialTurnLifecycle);
  let authorityEventOutbox = [];
  let authorityEventSequence = 0;
  const materializeTerminal = ({ terminalStatus = {}, event = {} } = {}) => {
    const contract = {
      completed: ["completed", "run_completed"],
      user_stopped: ["user_stopped", "user_stop"],
      error: ["error", "run_error"],
      aborted: ["error", "run_aborted"],
      timeout: ["timeout", "run_timeout"],
    }[terminalStatus.command];
    if (!contract) return { reason: "invalid_turn_status" };
    return { turnStatus: {
      version: 1,
      turnScopeId: event.turnScopeId || "",
      dialogProcessId: event.dialogProcessId || "",
      parentDialogProcessId: event.parentDialogProcessId || "",
      status: contract[0],
      reason: contract[1],
      description: terminalStatus.description || "",
    } };
  };
  const testBot = {
    ...suppliedBot,
    resolveExecutionIntent: suppliedBot.resolveExecutionIntent || (async ({ turnScopeId = "", runConfig = {} } = {}) => {
      const executionId = String(runConfig?.executionId || `agent:${turnScopeId}`).trim();
      return {
        executionId,
        executionKind: String(runConfig?.executionKind || "agent").trim(),
        parentExecutionId: String(runConfig?.parentExecutionId || "").trim(),
        rootExecutionId: String(runConfig?.rootExecutionId || executionId).trim(),
        origin: {},
        stage: "",
      };
    }),
    applyTurnLifecycleEvent: suppliedBot.applyTurnLifecycleEvent || (async (event = {}) => {
      const result = commitTurnLifecycle({
        lifecycle: turnLifecycle,
        event,
        eventOutbox: authorityEventOutbox,
        createEventId: () => `test-authority-event-${++authorityEventSequence}`,
        materializeTerminal: event.terminalStatus ? materializeTerminal : undefined,
      });
      if (result.applied) {
        turnLifecycle = result.lifecycle;
        authorityEventOutbox = result.eventOutbox;
      }
      return result;
    }),
    getPendingAuthorityEvents: suppliedBot.getPendingAuthorityEvents || (async () => ({
      found: true,
      events: listPendingAuthorityEvents(authorityEventOutbox),
    })),
    recordAuthorityEventAttempt: suppliedBot.recordAuthorityEventAttempt || (async ({ eventId } = {}) => {
      const result = recordAuthorityEventDeliveryAttempt(authorityEventOutbox, { eventId });
      if (result.found) authorityEventOutbox = result.outbox;
      return { recorded: result.found };
    }),
    acknowledgeAuthorityEvent: suppliedBot.acknowledgeAuthorityEvent || (async ({ eventId } = {}) => {
      const result = acknowledgeAuthorityEventDelivery(authorityEventOutbox, {
        eventId,
        deliveredAt: new Date().toISOString(),
      });
      if (result.found) authorityEventOutbox = result.outbox;
      return { acknowledged: result.found };
    }),
    upsertTurnStatus: suppliedBot.upsertTurnStatus || (async (payload = {}) => {
      const contract = {
        completed: ["completed", "run_completed"],
        user_stopped: ["user_stopped", "user_stop"],
        error: ["error", "run_error"],
        aborted: ["error", "run_aborted"],
        timeout: ["timeout", "run_timeout"],
      }[payload.command];
      assert.ok(contract, `unexpected terminal command: ${payload.command}`);
      assert.equal(payload.status, undefined);
      assert.equal(payload.reason, undefined);
      return { turnStatus: {
        turnScopeId: payload.turnScopeId || "",
        dialogProcessId: payload.dialogProcessId || "",
        parentDialogProcessId: payload.parentDialogProcessId || "",
        status: contract[0],
        reason: contract[1],
        description: payload.description || "",
      } };
    }),
  };
  if (typeof suppliedBot.applyTurnLifecycleEvent !== "function") {
    testBot.runSession = async (payload = {}) => {
      payload?.eventListener?.onEvent?.({
        event: "agent_lifecycle_state_changed",
        data: {
          state: "running",
          sessionId: String(payload?.sessionId || ""),
          turnScopeId: String(payload?.runConfig?.turnScopeId || ""),
        },
      });
      return suppliedBot.runSession(payload);
    };
  }
  if (typeof suppliedBot.persistStoppedAssistantMessage === "function") {
    testBot.persistStoppedAssistantMessage = async (payload = {}) => {
      const persisted = await suppliedBot.persistStoppedAssistantMessage(payload);
      if (persisted) return persisted;
      const assistant = payload.partialAssistant || {};
      return {
        turnScopeId: assistant.turnScopeId || "",
        dialogProcessId: assistant.dialogProcessId || "",
        parentDialogProcessId: payload.parentDialogProcessId || "",
        status: "user_stopped",
        reason: "user_stop",
        description: "用户停止了本轮生成",
      };
    };
  }

  const registered = registerChatWebSocketServer(server, {
    getBot: () => testBot,
    resolveRequestLocale: () => "zh-CN",
    resolveAuthByApiKey,
    isForbiddenUserScope,
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

export async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export async function waitForFile(filePath, { timeoutMs = 1000 } = {}) {
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

export async function waitForCondition(
  predicate,
  { timeoutMs = 1000, intervalMs = 5, message = "condition wait timed out" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

export async function closeServer(serverHandle) {
  const server = serverHandle?.server || serverHandle;
  const registered = serverHandle?.registered || null;
  const webSocketServer = registered?.webSocketServer || null;
  for (const client of webSocketServer?.clients || []) {
    client.terminate?.();
  }
  if (webSocketServer && typeof webSocketServer.close === "function") {
    await new Promise((resolve) => {
      try {
        webSocketServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
  if (!server?.listening) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

export async function callChatWs({ port, payload = {}, timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("chat websocket response timeout"));
    }, timeoutMs);
    const settle = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    ws.on("open", () => ws.send(JSON.stringify({
      ...payload,
      turnScopeId: String(payload?.turnScopeId || "test-turn"),
    })));
    ws.on("message", (raw) => {
      try {
        messages.push(JSON.parse(String(raw || "{}")));
      } catch (error) {
        ws.terminate();
        settle(reject, error);
      }
    });
    ws.on("close", () => settle(resolve, messages));
    ws.on("error", (error) => settle(reject, error));
  });
}

export async function stopChatWs({ port, payload = {}, stopPayload = {}, timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    let stopSent = false;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`, {
      headers: { authorization: "Bearer test-key" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("chat websocket stop timeout"));
    }, timeoutMs);
    const settle = (callback, value) => {
      clearTimeout(timer);
      callback(value);
    };
    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
    });
    ws.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw || "{}"));
        messages.push(parsed);
        if (!stopSent && parsed?.event === "turn_lifecycle" && parsed?.data?.capabilities?.canStop === true) {
          stopSent = true;
          ws.send(JSON.stringify({ action: "stop", ...stopPayload }));
        }
      } catch (error) {
        ws.terminate();
        settle(reject, error);
      }
    });
    ws.on("close", () => settle(resolve, messages));
    ws.on("error", (error) => settle(reject, error));
  });
}

export async function requestRawUpgrade({ port, pathName = "/chat/ws" } = {}) {
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
