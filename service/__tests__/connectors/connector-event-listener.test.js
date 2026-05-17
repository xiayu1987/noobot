import test from "node:test";
import assert from "node:assert/strict";

import {
  createConnectorEventListener,
} from "../../system-core/connectors/connector-event-listener.js";

function createBaseListener({
  allowUserInteraction = true,
  bridge = {},
} = {}) {
  return createConnectorEventListener({
    runtime: {
      userId: "admin",
      systemRuntime: {
        config: {
          allowUserInteraction,
        },
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
