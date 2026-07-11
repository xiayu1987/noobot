import assert from "node:assert/strict";
import { createServer } from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import { WebSocket } from "ws";
import { registerChatWebSocketServer } from "../../ws/chat-websocket-server.js";

export async function startServerWithWs({
  runSession = async () => ({}),
  bot = null,
  sessionLogConfig = undefined,
  resolveAuthByApiKey = () => ({ userId: "primary-user" }),
  isForbiddenUserScope = () => false,
} = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });

  const suppliedBot = bot || { runSession };
  const testBot = {
    ...suppliedBot,
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

export async function closeServer(serverHandle) {
  const server = serverHandle?.server || serverHandle;
  const registered = serverHandle?.registered || null;
  for (const client of registered?.webSocketServer?.clients || []) {
    client.terminate?.();
  }
  registered?.webSocketServer?.close?.();
  await new Promise((resolve) => server.close(resolve));
}

export async function callChatWs({ port, payload = {} } = {}) {
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

export async function stopChatWs({ port, payload = {}, stopPayload = {} } = {}) {
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
