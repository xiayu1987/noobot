/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { registerConnectorRoutes } from "../../routes/connectors-routes.js";
import { withTestServer } from "./session-routes.helpers.js";

function createHarness() {
  const catalog = [
    {
      instanceType: "builtin.database.postgres",
      type: "database",
      subType: "postgres",
      fields: [],
      operations: [
        {
          name: "execute",
          description: "Execute SQL.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    },
  ];
  const records = [
    {
      connectorId: "con_db",
      ownerUserId: "alice",
      name: "production",
      instanceType: "builtin.database.postgres",
      type: "database",
      subType: "postgres",
      operations: [
        {
          name: "execute",
          description: "Execute SQL.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    {
      connectorId: "con_mail",
      ownerUserId: "alice",
      name: "mail",
      instanceType: "builtin.email.smtp_imap",
      type: "email",
      subType: "smtp_imap",
      operations: [
        {
          name: "read",
          description: "Read mail.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
  ];
  const runtime = new Map([["con_db", { connectorId: "con_db", status: "connected" }]]);
  const selections = new Map([
    ["root-a", ["con_db"]],
    ["root-b", ["con_db", "con_mail"]],
  ]);
  const lifecycleCalls = [];
  const connectorRuntime = {
    listRegisteredInstances: () => catalog,
    listUserConnectors: async (userId) =>
      records
        .filter((item) => item.ownerUserId === userId)
        .map(({ ownerUserId: _ownerUserId, ...item }) => ({
          ...item,
          status: runtime.has(item.connectorId) ? "connected" : "disconnected",
        })),
    deleteConnector: async ({ userId, connectorId }) => {
      const index = records.findIndex(
        (item) => item.ownerUserId === userId && item.connectorId === connectorId,
      );
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
    disconnect: async ({ connectorId }) => runtime.delete(connectorId),
    createConnector: async ({ userId, name, instanceType, parameters }) => {
      lifecycleCalls.push({ operation: "create", userId, name, instanceType, parameters });
      return { connectorId: "con_created", ownerUserId: userId, name, instanceType, parameters };
    },
    connect: async ({ userId, connectorId }) => {
      lifecycleCalls.push({ operation: "connect", userId, connectorId });
      return {
        connected: true,
        connector: { connectorId, name: "created", status: "connected" },
      };
    },
  };
  const bot = {
    session: {
      listSessionIds: async () => ["root-a", "child-a", "root-b"],
      getRootSessionId: async ({ sessionId }) => (sessionId === "child-a" ? "root-a" : sessionId),
      getRootSessionSelectedConnectorIds: async ({ sessionId }) => selections.get(sessionId) || [],
      setRootSessionSelectedConnectorIds: async ({ sessionId, selectedConnectorIds }) => {
        selections.set(sessionId, selectedConnectorIds);
        return selectedConnectorIds;
      },
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: "alice", role: "user" };
    next();
  });
  registerConnectorRoutes(app, {
    bot,
    connectorRuntime,
    translateText: (key) => key,
  });
  return { app, records, runtime, selections, catalog, lifecycleCalls };
}

test("connector catalog exposes only runtime-registered instance definitions", async () => {
  const { app, catalog } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connectors/catalog`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).catalog, catalog);
  });
});

test("connector routes reject access outside the authenticated owner", async () => {
  const { app } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connectors/bob`);
    const payload = await response.json();
    assert.equal(response.status, 403);
    assert.equal(payload.errorCode, "connector_owner_mismatch");
  });
});

test("connector routes expose public metadata without credentials", async () => {
  const { app } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connectors/alice`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.connectors.length, 2);
    assert.equal(payload.connectors[0].status, "connected");
    assert.equal(JSON.stringify(payload).includes("secret"), false);
    assert.equal("parameters" in payload.connectors[0], false);
  });
});

test("creating a connector immediately runs its runtime connection lifecycle", async () => {
  const { app, lifecycleCalls } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connectors/alice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "created",
        instanceType: "builtin.database.postgres",
        parameters: { host: "database.internal" },
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(payload.connection.connected, true);
    assert.deepEqual(
      lifecycleCalls.map((item) => item.operation),
      ["create", "connect"],
    );
    assert.equal(lifecycleCalls[1].connectorId, "con_created");
  });
});

test("session selection accepts only owned connectors with active user connections", async () => {
  const { app, selections } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const disconnectedResponse = await fetch(
      `${baseUrl}/internal/connectors/alice/sessions/root-a/selection`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedConnectorIds: ["con_mail"] }),
      },
    );
    assert.equal(disconnectedResponse.status, 409);
    assert.equal((await disconnectedResponse.json()).errorCode, "connector_not_connected");

    const unknownResponse = await fetch(
      `${baseUrl}/internal/connectors/alice/sessions/root-a/selection`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedConnectorIds: ["con_other_user"] }),
      },
    );
    assert.equal(unknownResponse.status, 400);
    assert.deepEqual(selections.get("root-a"), ["con_db"]);
  });
});

test("disconnect removes the connector from every root session selection", async () => {
  const { app, runtime, selections } = createHarness();
  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/connectors/alice/con_db/disconnect`, {
      method: "POST",
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.updatedSessionCount, 2);
    assert.equal(runtime.has("con_db"), false);
    assert.deepEqual(selections.get("root-a"), []);
    assert.deepEqual(selections.get("root-b"), ["con_mail"]);
  });
});
