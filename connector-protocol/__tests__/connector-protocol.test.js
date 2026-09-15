/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertConnectorAccessPort,
  assertConnectorInstanceImplementation,
  CONNECTOR_ACCESS_CANCELLATION,
  connectorField,
  connectorOperation,
  createConnectorSecretAad,
  createConnectorInstanceDefinition,
  normalizeConnectorAccessContext,
  normalizeConnectorParameters,
  normalizeConnectorSecretEnvelope,
  normalizeSelectedConnectorIds,
  projectSelectedConnectorContext,
} from "../src/index.js";

test("connector definitions validate one canonical instance shape", () => {
  const definition = createConnectorInstanceDefinition({
    instanceType: "example.terminal.ssh",
    type: "terminal",
    subType: "ssh",
    fields: [connectorField("host", { required: true })],
    operations: [
      connectorOperation("execute", {
        description: "Execute a command.",
        inputSchema: { type: "object", properties: {} },
      }),
    ],
  });
  assert.deepEqual(normalizeConnectorParameters(definition, { host: "example.com" }), {
    host: "example.com",
  });
  assert.throws(() => normalizeConnectorParameters(definition, {}), /host/);
  const extensibleDefinition = createConnectorInstanceDefinition({
    instanceType: "example.cloud.storage",
    type: "cloud-storage",
    subType: "object-store",
    fields: [],
    operations: [
      connectorOperation("read", {
        description: "Read an object.",
        inputSchema: { type: "object", properties: {} },
      }),
    ],
  });
  assert.equal(extensibleDefinition.type, "cloud-storage");
  assert.throws(
    () =>
      createConnectorInstanceDefinition({
        instanceType: "example.invalid",
        type: "Cloud Storage",
        subType: "object-store",
        operations: [
          connectorOperation("read", {
            description: "Read an object.",
            inputSchema: { type: "object", properties: {} },
          }),
        ],
      }),
    /type/,
  );
});

test("connector secret protocol defines one authenticated envelope and identity binding", () => {
  assert.deepEqual(
    normalizeConnectorSecretEnvelope({
      version: 1,
      algorithm: "aes-256-gcm",
      iv: "iv",
      tag: "tag",
      ciphertext: "ciphertext",
    }),
    {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: "iv",
      tag: "tag",
      ciphertext: "ciphertext",
    },
  );
  assert.equal(
    createConnectorSecretAad({
      userId: "alice",
      connectorId: "con_1",
      instanceType: "builtin.database.postgres",
    }),
    '{"protocol":"noobot.connector.parameters","version":1,"userId":"alice","connectorId":"con_1","instanceType":"builtin.database.postgres"}',
  );
  assert.throws(
    () =>
      normalizeConnectorSecretEnvelope({
        version: 1,
        algorithm: "aes-256-cbc",
        iv: "iv",
        tag: "tag",
        ciphertext: "ciphertext",
      }),
    /algorithm/,
  );
});

test("connector selection is an ordered unique list and context excludes credentials", () => {
  assert.deepEqual(normalizeSelectedConnectorIds(["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(
    projectSelectedConnectorContext(
      ["a"],
      [{ connectorId: "a", name: "db", type: "database", subType: "mysql", password: "secret" }],
    ),
    [
      {
        connector_id: "a",
        connector_name: "db",
        connector_type: "database",
        connector_sub_type: "mysql",
        connector_operations: [],
      },
    ],
  );
});

test("connector access port exposes only the generic Agent operations", () => {
  const port = {
    access: async () => ({ ok: true }),
    listUserConnectors: async () => [],
  };
  assert.equal(assertConnectorAccessPort(port), port);
  assert.throws(
    () => assertConnectorAccessPort({ access: async () => ({ ok: true }) }),
    /listUserConnectors/,
  );
});

test("connector access context keeps one authoritative shape for request cancellation", () => {
  const controller = new AbortController();
  const sink = { write: () => {} };
  const context = normalizeConnectorAccessContext({
    sessionId: " s1 ",
    artifactSink: sink,
    abortSignal: controller.signal,
    unknown: "dropped",
  });
  assert.equal(context.sessionId, "s1");
  assert.equal(context.artifactSink, sink);
  assert.equal(context.abortSignal, controller.signal);
  assert.equal("unknown" in context, false);
  assert.equal(Object.isFrozen(context), true);
  const empty = normalizeConnectorAccessContext();
  assert.deepEqual(empty, { sessionId: "", artifactSink: null, abortSignal: null });
  assert.throws(
    () => normalizeConnectorAccessContext({ abortSignal: { aborted: false } }),
    /must be an AbortSignal/,
  );
});

test("connector implementations must declare their access cancellation semantics", () => {
  const base = {
    definition: createConnectorInstanceDefinition({
      instanceType: "example.database.mysql",
      type: "database",
      subType: "mysql",
      fields: [connectorField("host", { required: true })],
      operations: [
        connectorOperation("execute", {
          description: "Execute a command.",
          inputSchema: { type: "object", properties: {} },
        }),
      ],
    }),
    create: async () => ({}),
    health: async () => ({ ok: true }),
    access: async () => ({ ok: true }),
    dispose: async () => {},
  };
  assert.throws(
    () => assertConnectorInstanceImplementation(base),
    /connector access cancellation is invalid/,
  );
  assert.throws(
    () => assertConnectorInstanceImplementation({ ...base, accessCancellation: "maybe" }),
    /connector access cancellation is invalid/,
  );
  for (const semantics of Object.values(CONNECTOR_ACCESS_CANCELLATION)) {
    const implementation = { ...base, accessCancellation: semantics };
    assert.equal(assertConnectorInstanceImplementation(implementation), implementation);
  }
});
