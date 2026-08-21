/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { resolveConnectorStatusSection } from "../../src/context/providers/connector-status-provider.js";

const connectors = [
  {
    connectorId: "con_selected",
    ownerUserId: "alice",
    name: "selected database",
    type: "database",
    subType: "postgres",
    operations: [
      {
        name: "execute",
        description: "Execute SQL.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  },
  {
    connectorId: "con_unselected",
    ownerUserId: "alice",
    name: "private mail",
    type: "email",
    subType: "smtp_imap",
    operations: [
      { name: "read", description: "Read mail.", inputSchema: { type: "object", properties: {} } },
    ],
  },
];

test("connector system context projects only selected stable identity fields", async () => {
  const section = await resolveConnectorStatusSection({
    userId: "alice",
    selectedConnectorIds: ["con_selected"],
    connectorAccessPort: {
      access: async () => ({ ok: true }),
      listUserConnectors: async () => connectors,
    },
  });

  assert.deepEqual(section, {
    connectors: [
      {
        connector_id: "con_selected",
        connector_name: "selected database",
        connector_type: "database",
        connector_sub_type: "postgres",
        connector_operations: [
          {
            name: "execute",
            description: "Execute SQL.",
            input_schema: { type: "object", properties: {} },
          },
        ],
      },
    ],
  });
  const serialized = JSON.stringify(section);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("con_unselected"), false);
  assert.equal(serialized.includes("status"), false);
});

test("connector system context requires its authoritative runtime dependencies", async () => {
  await assert.rejects(
    () =>
      resolveConnectorStatusSection({
        userId: "alice",
        selectedConnectorIds: ["con_selected"],
      }),
    /selected connector access port is unavailable/,
  );
});

test("connector system context omits the section when the session selects nothing", async () => {
  assert.deepEqual(
    await resolveConnectorStatusSection({ userId: "alice", selectedConnectorIds: [] }),
    { connectors: [] },
  );
});
