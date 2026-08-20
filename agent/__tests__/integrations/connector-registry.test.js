/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemConnectorInstanceRepository } from "../../src/session/repositories/file-system-connector-instance-repository.js";
import { createSessionFacade, createSessionServices } from "../../src/session/index.js";

test("Session connector repository isolates owners and persists instances with owner-only permissions", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot });
    const created = await registry.create({
      userId: "u1",
      name: "mail",
      instanceType: "builtin.email.smtp_imap",
      parameters: {
        smtp_host: "smtp.example.test",
        imap_host: "imap.example.test",
        username: "user@example.test",
        password: "secret",
      },
      now: "2026-08-20T00:00:00.000Z",
    });
    assert.equal((await registry.list("u1")).length, 1);
    assert.equal((await registry.list("u2")).length, 0);
    assert.equal(await registry.get({ userId: "u2", connectorId: created.connectorId }), null);

    const registryPath = path.join(
      workspaceRoot,
      "u1",
      "runtime",
      "connectors",
      "connector-instances.json",
    );
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
    assert.match(await readFile(registryPath, "utf8"), /secret/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Session connector repository updates and deletes generic instance records", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot });
    const created = await registry.create({
      userId: "u1",
      name: "local",
      instanceType: "builtin.database.sqlite",
      parameters: { file_path: "data/local.sqlite" },
      now: "2026-08-20T00:00:00.000Z",
    });
    const updated = await registry.update({
      userId: "u1",
      connectorId: created.connectorId,
      name: "local-updated",
      instanceType: created.instanceType,
      parameters: created.parameters,
      now: "2026-08-20T00:01:00.000Z",
    });
    assert.equal(updated.name, "local-updated");
    assert.equal(await registry.delete({ userId: "u1", connectorId: created.connectorId }), true);
    assert.deepEqual(await registry.list("u1"), []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("Session facade is the connector instance persistence port", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const session = createSessionFacade(
      createSessionServices({ workspaceRoot }, { now: () => "2026-08-20T00:00:00.000Z" }),
    );
    const created = await session.createConnectorInstance({
      userId: "u1",
      name: "primary",
      instanceType: "custom.connector",
      parameters: { endpoint: "connector.example.test" },
      now: "2026-08-20T00:00:00.000Z",
    });

    assert.deepEqual(await session.listConnectorInstances({ userId: "u1" }), [created]);
    assert.deepEqual(
      await session.getConnectorInstance({ userId: "u1", connectorId: created.connectorId }),
      created,
    );

    const updated = await session.updateConnectorInstance({
      userId: "u1",
      connectorId: created.connectorId,
      name: "primary-renamed",
      instanceType: created.instanceType,
      parameters: created.parameters,
      now: "2026-08-20T00:01:00.000Z",
    });
    assert.equal(updated.name, "primary-renamed");
    assert.equal(
      await session.deleteConnectorInstance({
        userId: "u1",
        connectorId: created.connectorId,
      }),
      true,
    );
    assert.deepEqual(await session.listConnectorInstances({ userId: "u1" }), []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
