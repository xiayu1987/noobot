/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { registerChatWebSocketServer } from "../../ws/chat-websocket-server.js";
import { flushJsonLineBatches } from "@noobot/runtime-events";
import { registerLogWebSocketServer, writeSessionLogEvent } from "../../ws/log-websocket-server.js";
import {
  persistSession,
  sessionDirPath,
  withRuntimeEventsEnv,
  withRuntimeEventsRoot,
} from "../runtime-events-root.test-helpers.js";

async function sessionEventFile(workspaceRoot, sessionId, fileName) {
  return path.join(await sessionDirPath(workspaceRoot, "u1", sessionId), "events", fileName);
}

async function waitForJsonLines(file, predicate = (records) => records.length > 0) {
  const deadline = Date.now() + 2000;
  for (;;) {
    await flushJsonLineBatches();
    try {
      const records = (await fs.readFile(file, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (predicate(records)) return records;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function startLogServer({ resolveAuthByApiKey = () => ({ userId: "u1" }) } = {}) {
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end("not-found");
  });
  const registered = registerLogWebSocketServer(server, { resolveAuthByApiKey });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, registered };
}

async function closeLogServer(server, registered) {
  registered?.webSocketServer?.close?.();
  await new Promise((resolve) => server.close(resolve));
}

function sendLogWs({
  port,
  payload,
  pathName = "/logs/ws",
  apiKey = "test-key",
  terminalEvents = ["ack", "error"],
} = {}) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}${pathName}?apikey=${encodeURIComponent(apiKey)}`,
    );
    ws.on("open", () =>
      ws.send(typeof payload === "string" ? payload : JSON.stringify(payload || {})),
    );
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw || "{}"));
      messages.push(message);
      if (terminalEvents.includes(message.event)) ws.close();
    });
    ws.on("close", () => resolve(messages));
    ws.on("error", reject);
  });
}

test("log-websocket-server: writes session logs by category", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s1");
    const { server, registered } = await startLogServer();
    try {
      const { port } = server.address();
      const messages = await sendLogWs({
        port,
        payload: {
          source: "client",
          category: "state",
          event: "state.changed",
          scope: "session",
          sessionId: "s1",
          data: { state: "sending" },
        },
      });
      assert.equal(messages[0]?.event, "session_log_policy");
      assert.equal(messages.at(-1)?.event, "ack");
      const content = await fs.readFile(
        await sessionEventFile(workspaceRoot, "s1", "state.jsonl"),
        "utf8",
      );
      const record = JSON.parse(content.trim());
      assert.equal(record.sessionId, "s1");
      assert.equal(record.category, "state");
      assert.equal(record.event, "state.changed");
    } finally {
      await closeLogServer(server, registered);
    }
  }));

test("log-websocket-server: announces the effective client policy before ACK", () =>
  withRuntimeEventsRoot("noobot-session-logs-", (workspaceRoot) =>
    withRuntimeEventsEnv({ debug: { workflowDiagnostics: true } }, async () => {
      await persistSession(workspaceRoot, "u1", "s-policy");
      const { server, registered } = await startLogServer();
      try {
        const { port } = server.address();
        const messages = await sendLogWs({
          port,
          payload: {
            source: "client",
            category: "state",
            event: "state.policy",
            scope: "session",
            sessionId: "s-policy",
          },
        });
        assert.deepEqual(
          messages.map(({ event }) => event),
          ["session_log_policy", "ack"],
        );
        assert.equal(messages[0].policy.debug["workflow-diagnostics"], true);
        assert.equal(messages[0].policy.limits.maxDebugQueue > 0, true);
        assert.equal(messages[0].policy.limits.maxDebugBytes > 0, true);
        assert.equal(messages[0].policy.limits.debugTtlMs > 0, true);
      } finally {
        await closeLogServer(server, registered);
      }
    }),
  ));

test("log-websocket-server: mixed batches ACK after reliable writes without waiting for debug", () =>
  withRuntimeEventsEnv({ debug: { frontendToolLogWindow: true } }, async () => {
    let releaseDebug;
    const pendingDebug = new Promise((resolve) => {
      releaseDebug = resolve;
    });
    const writes = [];
    const server = createServer((_req, res) => res.end("not-found"));
    const registered = registerLogWebSocketServer(server, {
      resolveAuthByApiKey: () => ({ userId: "u1" }),
      writeLogEvent: async (event) => {
        writes.push(event);
        if (event.category === "debug") return pendingDebug;
        return { ok: true };
      },
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const messages = await sendLogWs({
        port: server.address().port,
        payload: {
          events: [
            {
              category: "debug",
              debugType: "tool-log-window",
              event: "debug.pending",
              scope: "session",
              sessionId: "s-mixed",
            },
            { scope: "session", category: "state", event: "state.reliable", sessionId: "s-mixed" },
          ],
        },
      });
      assert.equal(messages.at(-1)?.event, "ack");
      assert.equal(messages.at(-1)?.count, 2);
      assert.deepEqual(
        writes.map(({ event }) => event),
        ["debug.pending", "state.reliable"],
      );
    } finally {
      releaseDebug({ ok: true });
      await closeLogServer(server, registered);
    }
  }));

test("log-websocket-server: reliable write failures return error and never ACK", async () => {
  const server = createServer((_req, res) => res.end("not-found"));
  const registered = registerLogWebSocketServer(server, {
    resolveAuthByApiKey: () => ({ userId: "u1" }),
    writeLogEvent: async () => ({ ok: false, error: new Error("simulated reliable failure") }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const messages = await sendLogWs({
      port: server.address().port,
      payload: {
        scope: "session",
        category: "state",
        event: "state.failed",
        sessionId: "s-failed",
      },
    });
    assert.deepEqual(
      messages.map(({ event }) => event),
      ["session_log_policy", "error"],
    );
    assert.equal(
      messages.some(({ event }) => event === "ack"),
      false,
    );
    assert.equal(messages.at(-1).error, "simulated reliable failure");
  } finally {
    await closeLogServer(server, registered);
  }
});

test("log-websocket-server: batches containing a record without category return error and never ACK", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-batch");
    const { server, registered } = await startLogServer();
    try {
      const base = { source: "client", scope: "session", sessionId: "s-batch" };
      const messages = await sendLogWs({
        port: server.address().port,
        payload: {
          events: [
            { ...base, category: "state", event: "state.valid" },
            { ...base, event: "state.nocategory" },
          ],
        },
      });
      assert.deepEqual(
        messages.map(({ event }) => event),
        ["session_log_policy", "error"],
      );
      assert.match(messages.at(-1).error, /Invalid runtime event category: undefined/);
    } finally {
      await closeLogServer(server, registered);
    }
  }));

test("log-websocket-server: writes tool log window debug to its dedicated file", () =>
  withRuntimeEventsRoot("noobot-session-logs-", (workspaceRoot) =>
    withRuntimeEventsEnv({ debug: { frontendToolLogWindow: true } }, async () => {
      await persistSession(workspaceRoot, "u1", "s-tool-window");
      const { server, registered } = await startLogServer();
      try {
        const { port } = server.address();
        const messages = await sendLogWs({
          port,
          payload: {
            source: "frontend",
            category: "debug",
            level: "debug",
            debugType: "tool-log-window",
            event: "frontend.toolLogWindow.rendererReceived",
            scope: "session",
            sessionId: "s-tool-window",
            data: { debugType: "tool-log-window", selectedCount: 10 },
          },
        });
        assert.equal(messages[0]?.event, "session_log_policy");
        assert.equal(messages.at(-1)?.event, "ack");
        const file = await sessionEventFile(
          workspaceRoot,
          "s-tool-window",
          "debug-tool-log-window.jsonl",
        );
        const [record] = await waitForJsonLines(file);
        assert.equal(record.event, "frontend.toolLogWindow.rendererReceived");
        assert.equal(record.data.selectedCount, 10);
      } finally {
        await closeLogServer(server, registered);
      }
    }),
  ));

test("log-websocket-server: writes to the user runtime session events directory", () =>
  withRuntimeEventsRoot("noobot-workspace-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-runtime");
    const result = await writeSessionLogEvent({
      userId: "u1",
      source: "client",
      category: "message",
      event: "message.created",
      scope: "session",
      sessionId: "s-runtime",
    });
    const expectedFile = await sessionEventFile(workspaceRoot, "s-runtime", "message.jsonl");
    assert.equal(result.file, expectedFile);
    await flushJsonLineBatches();
    const record = JSON.parse((await fs.readFile(expectedFile, "utf8")).trim());
    assert.equal(record.sessionId, "s-runtime");
    assert.equal(record.category, "message");
  }));

test("log-websocket-server: works when chat websocket server is registered first", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "combined-s1");
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
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address();
      const messages = await sendLogWs({
        port,
        payload: {
          source: "client",
          category: "system",
          event: "system.log",
          scope: "session",
          sessionId: "combined-s1",
        },
      });
      assert.equal(messages[0]?.event, "session_log_policy");
      assert.equal(messages.at(-1)?.event, "ack");
      await flushJsonLineBatches();
      const content = await fs.readFile(
        await sessionEventFile(workspaceRoot, "combined-s1", "system.jsonl"),
        "utf8",
      );
      assert.equal(JSON.parse(content.trim()).event, "system.log");
    } finally {
      await closeLogServer(server, registered);
    }
  }));

test("log-websocket-server: skips registered debug types by default", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-debug");
    const result = await writeSessionLogEvent({
      source: "client",
      userId: "u1",
      category: "debug",
      debugType: "state-machine",
      scope: "session",
      sessionId: "s-debug",
      event: "debug.off",
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    const debugDir = await sessionDirPath(workspaceRoot, "u1", "s-debug");
    await assert.rejects(() => fs.stat(path.join(debugDir, "events")));
  }));

test("log-websocket-server: rejects debug logs without a registered debug type", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-debug");
    const result = await writeSessionLogEvent({
      source: "client",
      userId: "u1",
      category: "debug",
      scope: "session",
      sessionId: "s-debug",
      event: "debug.untyped",
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /Invalid runtime event debugType: undefined/);
    const debugDir = await sessionDirPath(workspaceRoot, "u1", "s-debug");
    await assert.rejects(() => fs.stat(path.join(debugDir, "events")));
  }));

test("log-websocket-server: rejects records without an explicit scope", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-noscope");
    const result = await writeSessionLogEvent({
      source: "client",
      userId: "u1",
      category: "state",
      sessionId: "s-noscope",
      event: "state.noscope",
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /Invalid runtime event scope: undefined/);
  }));

test("log-websocket-server: rejects records without an explicit category", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await persistSession(workspaceRoot, "u1", "s-nocategory");
    const result = await writeSessionLogEvent({
      source: "client",
      userId: "u1",
      scope: "session",
      sessionId: "s-nocategory",
      event: "state.nocategory",
    });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /Invalid runtime event category: undefined/);
    const sessionDir = await sessionDirPath(workspaceRoot, "u1", "s-nocategory");
    await assert.rejects(() => fs.stat(path.join(sessionDir, "events")));
  }));

test("log-websocket-server: debug records follow only their debugType switch", () =>
  withRuntimeEventsRoot("noobot-session-logs-", async (workspaceRoot) => {
    await withRuntimeEventsEnv(
      { log: { system: false }, debug: { stateMachine: true } },
      async () => {
        await persistSession(workspaceRoot, "u1", "s-debug-on");
        const debug = await writeSessionLogEvent({
          source: "client",
          userId: "u1",
          category: "debug",
          debugType: "state-machine",
          scope: "session",
          sessionId: "s-debug-on",
          event: "debug.on",
        });
        assert.equal(debug.ok, true);
        assert.notEqual(debug.skipped, true);
        const system = await writeSessionLogEvent({
          source: "client",
          userId: "u1",
          category: "system",
          scope: "session",
          sessionId: "s-debug-on",
          event: "system.off",
        });
        assert.equal(system.ok, true);
        assert.equal(system.skipped, true);
      },
    );
  }));

test("log-websocket-server: failed writes are not reported as written", () =>
  withRuntimeEventsRoot("noobot-session-logs-", (workspaceRoot) =>
    withRuntimeEventsEnv({ debug: { sessionLogWs: true } }, async () => {
      await persistSession(workspaceRoot, "u1", "s-ok");
      const failed = await writeSessionLogEvent({
        source: "client",
        userId: "u1",
        category: "state",
        sessionId: "s-failed",
        event: "state.failed",
      });
      assert.equal(failed.ok, false);
      const written = await writeSessionLogEvent({
        source: "client",
        userId: "u1",
        category: "state",
        scope: "session",
        sessionId: "s-ok",
        event: "state.ok",
      });
      assert.equal(written.ok, true);
      const diagnosticFile = path.join(
        workspaceRoot,
        "system",
        "runtime",
        "events",
        "system",
        "service",
        "debug.jsonl",
      );
      const isWritten = (record) => record.data?.message === "written";
      const diagnostics = (
        await waitForJsonLines(diagnosticFile, (records) =>
          records.some((record) => isWritten(record) && record.data.sessionId === "s-ok"),
        )
      ).filter(isWritten);
      assert.deepEqual(
        diagnostics.map((record) => record.data.sessionId),
        ["s-ok"],
      );
    }),
  ));

test("log-websocket-server: rejects unauthorized upgrade", async () => {
  const { server, registered } = await startLogServer({
    resolveAuthByApiKey: () => null,
  });
  try {
    const { port } = server.address();
    await assert.rejects(() => sendLogWs({ port, payload: { sessionId: "s1" } }));
  } finally {
    await closeLogServer(server, registered);
  }
});

test("log-websocket-server: rejects too large payload and batch", async () => {
  const { server, registered } = await startLogServer();
  try {
    const { port } = server.address();
    const tooLarge = await sendLogWs({ port, payload: "x".repeat(256 * 1024 + 1) });
    assert.equal(tooLarge.at(-1)?.event, "error");
    const tooMany = await sendLogWs({
      port,
      payload: {
        events: Array.from({ length: 101 }, (_, i) => ({ sessionId: "s1", event: `e${i}` })),
      },
    });
    assert.equal(tooMany.at(-1)?.event, "error");
  } finally {
    await closeLogServer(server, registered);
  }
});
