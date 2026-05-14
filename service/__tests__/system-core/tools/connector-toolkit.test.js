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
