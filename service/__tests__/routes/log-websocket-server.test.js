/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { registerChatWebSocketServer } from "../../ws/chat-websocket-server.js";
import {
  cleanupSessionLogs,
  registerLogWebSocketServer,
  resolveSessionLogConfig,
  writeSessionLogEvent,
} from "../../ws/log-websocket-server.js";

async function withTempLogDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "noobot-session-logs-"));
}

async function startLogServer({ logConfig, resolveAuthByApiKey = () => ({ userId: "u1" }) } = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });
  const registered = registerLogWebSocketServer(server, { resolveAuthByApiKey, logConfig });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, registered };
}

async function closeLogServer(server, registered) {
  clearInterval(registered?.cleanupTimer);
  registered?.webSocketServer?.close?.();
  await new Promise((resolve) => server.close(resolve));
}

function sendLogWs({ port, payload, pathName = "/logs/ws", apiKey = "test-key" } = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}${pathName}?apikey=${encodeURIComponent(apiKey)}`);
    ws.on("open", () => ws.send(typeof payload === "string" ? payload : JSON.stringify(payload || {})));
    ws.on("message", (raw) => {
      messages.push(JSON.parse(String(raw || "{}")));
      ws.close();
    });
    ws.on("close", () => resolve(messages));
    ws.on("error", reject);
  });
}

test("log-websocket-server: writes session logs by category", async () => {
  const logRoot = await withTempLogDir();
  const logConfig = { logRoot, retentionMs: 60000, cleanupIntervalMs: 60000 };
  const { server, registered } = await startLogServer({ logConfig });
  try {
    const { port } = server.address();
    const messages = await sendLogWs({
      port,
      payload: { source: "client", category: "state", event: "state.changed", sessionId: "s1", data: { state: "sending" } },
    });
    assert.equal(messages[0]?.event, "ack");
    const content = await fs.readFile(path.join(logRoot, "s1", "state.jsonl"), "utf8");
    const record = JSON.parse(content.trim());
    assert.equal(record.sessionId, "s1");
    assert.equal(record.category, "state");
    assert.equal(record.event, "state.changed");
  } finally {
    await closeLogServer(server, registered);
    await fs.rm(logRoot, { recursive: true, force: true });
  }
});

test("log-websocket-server: writes to user runtime session directory by default", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-"));
  const config = resolveSessionLogConfig({ workspaceRoot, retentionMs: 60000, cleanupIntervalMs: 60000 });
  try {
    const result = await writeSessionLogEvent({
      userId: "u1",
      source: "client",
      category: "message",
      event: "message.created",
      sessionId: "s-runtime",
    }, config);
    const expectedFile = path.join(workspaceRoot, "u1", "runtime", "session", "s-runtime", "logs", "message.jsonl");
    assert.equal(result.file, expectedFile);
    const record = JSON.parse((await fs.readFile(expectedFile, "utf8")).trim());
    assert.equal(record.sessionId, "s-runtime");
    assert.equal(record.category, "message");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("log-websocket-server: resolves configurable workspace roots without hardcoded linux root", async () => {
  const macWorkspaceRoot = path.resolve("/tmp/noobot-workspace-root");
  const macConfig = resolveSessionLogConfig({ workspaceRoot: macWorkspaceRoot });
  assert.equal(macConfig.workspaceRoot, macWorkspaceRoot);

  const relativeWorkspaceRoot = path.join("relative", "workspace-root");
  const relativeConfig = resolveSessionLogConfig({ workspaceRoot: relativeWorkspaceRoot });
  assert.equal(relativeConfig.workspaceRoot, path.resolve(relativeWorkspaceRoot));

  const explicitLogRoot = path.join(os.tmpdir(), "noobot-explicit-log-root");
  const explicitConfig = resolveSessionLogConfig({ workspaceRoot: macWorkspaceRoot, logRoot: explicitLogRoot });
  assert.equal(explicitConfig.logRoot, path.resolve(explicitLogRoot));
  assert.equal(explicitConfig.workspaceRoot, macWorkspaceRoot);
});

test("log-websocket-server: works when chat websocket server is registered first", async () => {
  const logRoot = await withTempLogDir();
  const logConfig = { logRoot, retentionMs: 60000, cleanupIntervalMs: 60000 };
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });
  registerChatWebSocketServer(server, {
    getBot: () => ({ runSession: async () => ({}) }),
    resolveRequestLocale: () => "zh-CN",
    resolveAuthByApiKey: () => ({ userId: "u1" }),
    isForbiddenUserScope: () => false,
    normalizeRunConfig: (config = {}) => config || {},
    normalizeLocale: (locale = "") => String(locale || "zh-CN"),
    defaultLocale: "zh-CN",
    translateText: (key = "") => String(key || ""),
  });
  const registered = registerLogWebSocketServer(server, {
    resolveAuthByApiKey: () => ({ userId: "u1" }),
    logConfig,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    const messages = await sendLogWs({
      port,
      payload: { source: "client", category: "system", event: "system.log", sessionId: "combined-s1" },
    });
    assert.equal(messages[0]?.event, "ack");
    const content = await fs.readFile(path.join(logRoot, "combined-s1", "system.jsonl"), "utf8");
    assert.equal(JSON.parse(content.trim()).event, "system.log");
  } finally {
    await closeLogServer(server, registered);
    await fs.rm(logRoot, { recursive: true, force: true });
  }
});

test("log-websocket-server: skips debug logs by default", async () => {
  const logRoot = await withTempLogDir();
  const result = await writeSessionLogEvent({ source: "client", userId: "u1", category: "debug", sessionId: "s-debug", event: "debug.off" }, { logRoot });
  assert.equal(result.skipped, true);
  await assert.rejects(() => fs.stat(path.join(logRoot, "s-debug", "debug.jsonl")));
  await fs.rm(logRoot, { recursive: true, force: true });
});

test("log-websocket-server: rejects unauthorized upgrade", async () => {
  const logRoot = await withTempLogDir();
  const { server, registered } = await startLogServer({
    logConfig: { logRoot, retentionMs: 60000, cleanupIntervalMs: 60000 },
    resolveAuthByApiKey: () => null,
  });
  try {
    const { port } = server.address();
    await assert.rejects(() => sendLogWs({ port, payload: { sessionId: "s1" } }));
  } finally {
    await closeLogServer(server, registered);
    await fs.rm(logRoot, { recursive: true, force: true });
  }
});

test("log-websocket-server: rejects too large payload and batch", async () => {
  const logRoot = await withTempLogDir();
  const { server, registered } = await startLogServer({
    logConfig: { logRoot, retentionMs: 60000, cleanupIntervalMs: 60000 },
  });
  try {
    const { port } = server.address();
    const tooLarge = await sendLogWs({ port, payload: "x".repeat(256 * 1024 + 1) });
    assert.equal(tooLarge[0]?.event, "error");
    const tooMany = await sendLogWs({ port, payload: { events: Array.from({ length: 101 }, (_, i) => ({ sessionId: "s1", event: `e${i}` })) } });
    assert.equal(tooMany[0]?.event, "error");
  } finally {
    await closeLogServer(server, registered);
    await fs.rm(logRoot, { recursive: true, force: true });
  }
});

test("log-websocket-server: cleanup removes expired session directories", async () => {
  const logRoot = await withTempLogDir();
  const oldDir = path.join(logRoot, "old-session");
  await fs.mkdir(oldDir, { recursive: true });
  const oldTime = new Date(Date.now() - 10000);
  await fs.utimes(oldDir, oldTime, oldTime);
  const result = await cleanupSessionLogs({ logRoot, retentionMs: 1, cleanupIntervalMs: 60000 }, Date.now());
  assert.equal(result.removed, 1);
  await assert.rejects(() => fs.stat(oldDir));
  await fs.rm(logRoot, { recursive: true, force: true });
});

test("log-websocket-server: cleanup skips user runtime tree when logRoot is not explicit", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workspace-"));
  const sessionDir = path.join(workspaceRoot, "u1", "runtime", "session", "s1");
  await fs.mkdir(sessionDir, { recursive: true });
  const result = await cleanupSessionLogs(resolveSessionLogConfig({ workspaceRoot, retentionMs: 1, cleanupIntervalMs: 60000 }), Date.now());
  assert.equal(result.skipped, true);
  await fs.stat(sessionDir);
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
