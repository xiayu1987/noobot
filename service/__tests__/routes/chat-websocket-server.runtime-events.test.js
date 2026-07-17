/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { recordServiceWebSocketRuntimeError, recordServiceWebSocketSendFailure } from "../../ws/chat-websocket-server.js";
import { startServerWithWs, closeServer, readJsonl, waitForFile, requestRawUpgrade } from "./chat-websocket-server.test-helpers.js";

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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-runtime-events-"));
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
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-service-runtime-events-error-"));
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
