/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorTools } from "../../src/tools/connectors/connector-toolkit.js";

const records = [
  {
    connectorId: "con_selected",
    ownerUserId: "u1",
    name: "main",
    type: "database",
    subType: "sqlite",
  },
  {
    connectorId: "con_other",
    ownerUserId: "u1",
    name: "other",
    type: "database",
    subType: "sqlite",
  },
];

function createScope({ selectedConnectorIds = ["con_selected"] } = {}) {
  const executed = [];
  const runtimeChannels = new Map([
    [
      "con_selected",
      {
        connectorId: "con_selected",
        name: "main",
        type: "database",
        subType: "sqlite",
        status: "connected",
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);
  const runtime = {
    userId: "u1",
    globalConfig: {},
    userConfig: {},
    systemRuntime: { sessionId: "s1", config: { selectedConnectorIds } },
    sharedTools: {
      connectorRegistry: {
        async list() {
          return records;
        },
        async get({ connectorId }) {
          return records.find((item) => item.connectorId === connectorId) || null;
        },
      },
      connectorChannelStore: {
        getUserConnectors() {
          return [...runtimeChannels.values()];
        },
        getConnector({ connectorId }) {
          return runtimeChannels.get(connectorId) || null;
        },
        async executeConnectorCommand(payload) {
          executed.push(payload);
          return {
            ok: true,
            connector: runtimeChannels.get(payload.connectorId),
            output: { code: 0, stdout: "ok", stderr: "" },
          };
        },
      },
    },
  };
  return { scope: { userId: "u1", bindings: { runtime } }, executed };
}

test("connector toolkit exposes access and inspection but no model connection tools", () => {
  const { scope } = createScope();
  assert.deepEqual(
    createConnectorTools({ agentContext: scope }).map((tool) => tool.name),
    ["access_connector", "inspect_connectors"],
  );
});

test("access_connector requires an explicitly selected connector id", async () => {
  const { scope } = createScope();
  const accessTool = createConnectorTools({ agentContext: scope })[0];
  await assert.rejects(
    () => accessTool.invoke({ connector_id: "con_other", command: "SELECT 1" }),
    /not selected/,
  );
});

test("access_connector executes the selected user connector without reconnecting", async () => {
  const { scope, executed } = createScope();
  const accessTool = createConnectorTools({ agentContext: scope })[0];
  const result = JSON.parse(
    await accessTool.invoke({ connector_id: "con_selected", command: "SELECT 1" }),
  );
  assert.equal(result.ok, true);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].userId, "u1");
  assert.equal(executed[0].connectorId, "con_selected");
});

test("inspect_connectors returns only selected connector metadata", async () => {
  const { scope } = createScope();
  const inspectTool = createConnectorTools({ agentContext: scope })[1];
  const result = JSON.parse(await inspectTool.invoke({}));
  assert.deepEqual(
    result.connectors.map((item) => item.connectorId),
    ["con_selected"],
  );
  assert.equal(JSON.stringify(result).includes("parameters"), false);
});
