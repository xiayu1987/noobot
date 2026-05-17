import test from "node:test";
import assert from "node:assert/strict";

import { createConnectorTools } from "../../../system-core/tools/connectors/connector-toolkit.js";

function parseToolJson(raw = "") {
  return JSON.parse(String(raw || "{}"));
}

test("connector-toolkit/inspect_connectors: 应返回连接器汇总", async () => {
  const runtime = {
    systemRuntime: {
      sessionId: "s-child",
      rootSessionId: "s-root",
      config: {},
    },
    sharedTools: {
      connectorChannelStore: {
        async inspectSessionConnectors() {
          return {
            connectors: {
              databases: [{ connector_name: "db-main" }],
              terminals: [{ connector_name: "ssh-main" }],
              emails: [{ connector_name: "mail-main" }],
            },
            summary: { total_count: 3 },
          };
        },
        getSessionConnectors() {
          return {
            databases: [{ connector_name: "db-main" }],
            terminals: [{ connector_name: "ssh-main" }],
            emails: [{ connector_name: "mail-main" }],
          };
        },
      },
      connectorEventListener: {
        syncRuntimeConnectorChannels() {},
      },
    },
    globalConfig: {},
    userConfig: {},
  };

  const tools = createConnectorTools({
    agentContext: { runtime },
  });
  const inspectTool = tools.find((tool) => tool?.name === "inspect_connectors");
  assert.ok(inspectTool, "inspect_connectors 工具应存在");

  const payload = parseToolJson(await inspectTool.invoke({}));
  assert.equal(payload.ok, true);
  assert.equal(payload.status, "completed");
  assert.equal(payload.summary?.total_count, 3);
  assert.equal(payload.summary?.database_count, 1);
  assert.equal(payload.summary?.terminal_count, 1);
  assert.equal(payload.summary?.email_count, 1);
});

test("connector-toolkit/database_connect_connector: 交互补全应携带 pending/manual 语义字段", async () => {
  const interactionCalls = [];
  const runtime = {
    systemRuntime: {
      sessionId: "s-child",
      rootSessionId: "s-root",
      dialogProcessId: "dp-1",
      config: { allowUserInteraction: true },
    },
    userInteractionBridge: {
      async requestUserInteraction(payload = {}) {
        interactionCalls.push(payload);
        return {
          host: "127.0.0.1",
          port: 3306,
          username: "u1",
          password: "p1",
          database: "db1",
        };
      },
    },
    sharedTools: {
      connectorChannelStore: {
        connectConnector({ sessionId, connectorName, connectorType, connectionInfo }) {
          return {
            sessionId,
            connectorName,
            connectorType,
            connectionInfo,
          };
        },
        inspectConnectorRuntimeStatus() {
          return {
            status: "connected",
            status_code: 0,
            status_message: "ok",
            checked_at: "2026-05-17T00:00:00.000Z",
          };
        },
        getSessionConnectors() {
          return {
            databases: [],
            terminals: [],
            emails: [],
          };
        },
      },
      connectorEventListener: {
        async onConnectorConnected() {},
        onConnectorAlreadyConnected() {},
        syncRuntimeConnectorChannels() {},
      },
    },
    globalConfig: {},
    userConfig: {},
  };

  const tools = createConnectorTools({
    agentContext: { runtime },
  });
  const connectTool = tools.find((tool) => tool?.name === "database_connect_connector");
  assert.ok(connectTool, "database_connect_connector 工具应存在");

  const payload = parseToolJson(
    await connectTool.invoke({
      connector_name: "db-main",
      database_type: "mysql",
      default_values: {},
    }),
  );

  assert.equal(payload.ok, true);
  assert.equal(payload.status, "connected");
  assert.equal(interactionCalls.length, 1);
  assert.equal(String(interactionCalls[0]?.lifecycle || ""), "pending");
  assert.equal(String(interactionCalls[0]?.ackMode || ""), "manual");
  assert.equal(String(interactionCalls[0]?.resolvedBy || ""), "");
});
