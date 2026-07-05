import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createConnectorEventListener,
} from "../../../src/system-core/connectors/connector-event-listener.js";

function createBaseListener({
  allowUserInteraction = true,
  bridge = {},
  workspaceRoot = "",
} = {}) {
  return createConnectorEventListener({
    runtime: {
      userId: "primary-user",
      systemRuntime: {
        config: {
          allowUserInteraction,
        },
      },
      globalConfig: {
        workspaceRoot,
      },
    },
    store: null,
    historyStore: null,
    rootSessionId: "root-session-1",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    allowUserInteraction,
    bridge,
  });
}

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("ConnectorEventListener.notifyConnectorConnected: informational flow should emit connector_status notification", async () => {
  const emitCalls = [];
  const requestCalls = [];
  const listener = createBaseListener({
    bridge: {
      emitNotification: async (payload = {}) => {
        emitCalls.push(payload);
        return { ok: true };
      },
      requestUserInteraction: async (payload = {}) => {
        requestCalls.push(payload);
        return { ok: true };
      },
    },
  });

  await listener.notifyConnectorConnected({
    connectorType: "email",
    connectorName: "example_email",
  });

  assert.equal(emitCalls.length, 1);
  assert.equal(requestCalls.length, 0);
  assert.equal(String(emitCalls[0]?.eventName || ""), "connector_status");
  assert.equal(String(emitCalls[0]?.data?.connectorType || ""), "email");
  assert.equal(String(emitCalls[0]?.data?.connectorName || ""), "example_email");
  assert.equal(String(emitCalls[0]?.data?.status || ""), "connected");
  assert.equal(
    String(emitCalls[0]?.data?.interactionType || ""),
    "connector_connected",
  );
  assert.equal(String(emitCalls[0]?.data?.lifecycle || ""), "resolved");
  assert.equal(String(emitCalls[0]?.data?.ackMode || ""), "auto");
  assert.equal(String(emitCalls[0]?.data?.resolvedBy || ""), "system");
  assert.equal(emitCalls[0]?.data?.notification?.enabled, true);
  assert.equal(String(emitCalls[0]?.data?.notification?.level || ""), "success");
});

test("ConnectorEventListener.notifyConnectorConnected: fallback to requestUserInteraction when emitNotification is unavailable", async () => {
  const requestCalls = [];
  const listener = createBaseListener({
    bridge: {
      requestUserInteraction: async (payload = {}) => {
        requestCalls.push(payload);
        return { ok: true };
      },
    },
  });

  await listener.notifyConnectorConnected({
    connectorType: "email",
    connectorName: "example_email",
  });

  assert.equal(requestCalls.length, 1);
  assert.equal(String(requestCalls[0]?.interactionType || ""), "connector_connected");
  assert.equal(String(requestCalls[0]?.connectorType || ""), "email");
  assert.equal(String(requestCalls[0]?.connectorName || ""), "example_email");
  assert.equal(String(requestCalls[0]?.lifecycle || ""), "resolved");
  assert.equal(String(requestCalls[0]?.ackMode || ""), "auto");
  assert.equal(String(requestCalls[0]?.resolvedBy || ""), "system");
});

test("ConnectorEventListener.notifyConnectorConnected: failed bridge writes telemetry session system log", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-connector-telemetry-"));
  const listener = createBaseListener({
    workspaceRoot,
    bridge: {
      emitNotification: async () => {
        throw new Error("emit failed");
      },
    },
  });

  await listener.notifyConnectorConnected({
    connectorType: "email",
    connectorName: "example_email",
  });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "primary-user",
    "runtime",
    "session",
    "session-1",
    "logs",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "agent");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].event, "agent.connector.notifyConnectorConnected.failed");
  assert.equal(records[0].userId, "primary-user");
  assert.equal(records[0].sessionId, "session-1");
  assert.equal(records[0].dialogProcessId, "dialog-1");
  assert.equal(records[0].data.connectorType, "email");
  assert.equal(records[0].data.connectorName, "example_email");
  assert.equal(records[0].data.error, "emit failed");
});

test("ConnectorEventListener.notifyReconnectRequired: failed interaction writes telemetry session system log", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-connector-reconnect-"));
  const listener = createBaseListener({
    workspaceRoot,
    bridge: {
      requestUserInteraction: async () => {
        throw new Error("interaction failed");
      },
    },
  });

  await listener.notifyReconnectRequired({
    connectorType: "database",
    connectorName: "main_db",
    reconnectToolName: "connect_database",
  });

  const records = await readJsonl(path.join(
    workspaceRoot,
    "primary-user",
    "runtime",
    "session",
    "session-1",
    "logs",
    "system.jsonl",
  ));
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "agent");
  assert.equal(records[0].channel, "direct");
  assert.equal(records[0].category, "system");
  assert.equal(records[0].event, "agent.connector.notifyReconnectRequired.failed");
  assert.equal(records[0].userId, "primary-user");
  assert.equal(records[0].sessionId, "session-1");
  assert.equal(records[0].dialogProcessId, "dialog-1");
  assert.equal(records[0].data.connectorType, "database");
  assert.equal(records[0].data.connectorName, "main_db");
  assert.equal(records[0].data.reconnectToolName, "connect_database");
  assert.equal(records[0].data.error, "interaction failed");
});
