/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createConnectorInstanceDefinition, connectorField } from "@noobot/connector-protocol";
import { ConnectorRuntime } from "../src/index.js";

function repository() {
  const records = [];
  return {
    list: async (userId) => records.filter((item) => item.ownerUserId === userId),
    get: async ({ userId, connectorId }) =>
      records.find((item) => item.ownerUserId === userId && item.connectorId === connectorId) ||
      null,
    create: async (input) => {
      const record = {
        ...input,
        connectorId: `con_${records.length + 1}`,
        ownerUserId: input.userId,
      };
      records.push(record);
      return record;
    },
    update: async () => null,
    delete: async () => false,
  };
}

test("runtime rejects unregistered instances and owns their lifecycle", async () => {
  const runtime = new ConnectorRuntime({ repository: repository(), workspaceRoot: "/workspace" });
  await assert.rejects(
    runtime.createConnector({ userId: "u1", name: "x", instanceType: "missing" }),
    /not registered/,
  );
  let disposed = false;
  runtime.register({
    definition: createConnectorInstanceDefinition({
      instanceType: "test.echo",
      type: "terminal",
      subType: "echo",
      fields: [connectorField("token", { required: true, secret: true })],
      operations: ["execute"],
    }),
    create: async () => ({ ready: true }),
    health: async () => ({ ok: true }),
    access: async ({ request }) => ({ ok: true, output: request.input }),
    dispose: async () => {
      disposed = true;
    },
  });
  const record = await runtime.createConnector({
    userId: "u1",
    name: "echo",
    instanceType: "test.echo",
    parameters: { token: "secret" },
  });
  const connection = await runtime.connect({ userId: "u1", connectorId: record.connectorId });
  assert.equal(connection.connected, true);
  assert.equal(connection.connector.status, "connected");
  const result = await runtime.access({
    userId: "u1",
    request: { connectorId: record.connectorId, operation: "execute", input: { value: 1 } },
  });
  assert.deepEqual(result.output, { value: 1 });
  await assert.rejects(
    runtime.access({
      userId: "u2",
      request: { connectorId: record.connectorId, operation: "execute", input: {} },
    }),
    /not found/,
  );
  await runtime.disconnect({ userId: "u1", connectorId: record.connectorId });
  assert.equal(disposed, true);
});

test("runtime resolves workspace fields inside the authoritative user workspace", async () => {
  const runtime = new ConnectorRuntime({ repository: repository(), workspaceRoot: "/workspace" });
  runtime.register({
    definition: createConnectorInstanceDefinition({
      instanceType: "test.file",
      type: "database",
      subType: "file",
      fields: [connectorField("file", { required: true, kind: "workspace_path" })],
      operations: ["execute"],
    }),
    create: async () => ({}),
    health: async () => ({ ok: true }),
    access: async () => ({ ok: true, output: {} }),
    dispose: async () => {},
  });
  const record = await runtime.createConnector({
    userId: "u1",
    name: "inside",
    instanceType: "test.file",
    parameters: { file: "data/example.db" },
  });
  assert.equal(record.parameters.file, "/workspace/u1/data/example.db");
  await assert.rejects(
    runtime.createConnector({
      userId: "u1",
      name: "outside",
      instanceType: "test.file",
      parameters: { file: "../outside.db" },
    }),
    /outside user workspace/,
  );
});

test("runtime serializes access and disposal for one connector", async () => {
  const runtime = new ConnectorRuntime({ repository: repository(), workspaceRoot: "/workspace" });
  const events = [];
  let markAccessStarted;
  let finishAccess;
  const accessStarted = new Promise((resolve) => {
    markAccessStarted = resolve;
  });
  const accessGate = new Promise((resolve) => {
    finishAccess = resolve;
  });
  runtime.register({
    definition: createConnectorInstanceDefinition({
      instanceType: "test.serial",
      type: "terminal",
      subType: "serial",
      fields: [],
      operations: ["execute"],
    }),
    create: async () => ({}),
    health: async () => ({ ok: true }),
    access: async () => {
      events.push("access-start");
      markAccessStarted();
      await accessGate;
      events.push("access-end");
      return { ok: true, output: {} };
    },
    dispose: async () => events.push("dispose"),
  });
  const record = await runtime.createConnector({
    userId: "u1",
    name: "serial",
    instanceType: "test.serial",
  });
  await runtime.connect({ userId: "u1", connectorId: record.connectorId });
  const access = runtime.access({
    userId: "u1",
    request: { connectorId: record.connectorId, operation: "execute", input: {} },
  });
  await accessStarted;
  const disconnect = runtime.disconnect({ userId: "u1", connectorId: record.connectorId });
  assert.deepEqual(events, ["access-start"]);
  finishAccess();
  await Promise.all([access, disconnect]);
  assert.deepEqual(events, ["access-start", "access-end", "dispose"]);
});
