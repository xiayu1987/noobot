/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemConnectorInstanceRepository } from "../../src/session/repositories/file-system-connector-instance-repository.js";
import { createSessionFacade, createSessionServices } from "../../src/session/index.js";

const sealedParameters = (ciphertext = "c2VhbGVk") => ({
  version: 1,
  algorithm: "aes-256-gcm",
  iv: "aXY=",
  tag: "dGFn",
  ciphertext,
});

test("Session connector repository isolates owners and persists instances with owner-only permissions", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot });
    const created = await registry.create({
      userId: "u1",
      connectorId: "con_mail",
      name: "mail",
      instanceType: "builtin.email.smtp_imap",
      sealedParameters: sealedParameters(),
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
    assert.doesNotMatch(await readFile(registryPath, "utf8"), /password|secret/);
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
      connectorId: "con_local",
      name: "local",
      instanceType: "builtin.database.sqlite",
      sealedParameters: sealedParameters(),
      now: "2026-08-20T00:00:00.000Z",
    });
    const updated = await registry.update({
      userId: "u1",
      connectorId: created.connectorId,
      name: "local-updated",
      instanceType: created.instanceType,
      sealedParameters: created.sealedParameters,
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
      connectorId: "con_primary",
      name: "primary",
      instanceType: "custom.connector",
      sealedParameters: sealedParameters(),
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
      sealedParameters: created.sealedParameters,
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

test("connector registry accepts plaintext only through the explicit version 2 migration", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registryPath = path.join(
      workspaceRoot,
      "u1",
      "runtime",
      "connectors",
      "connector-instances.json",
    );
    await mkdir(path.dirname(registryPath), { recursive: true });
    await writeFile(
      registryPath,
      JSON.stringify({
        version: 2,
        connectors: [
          {
            connectorId: "con_legacy",
            ownerUserId: "u1",
            name: "legacy",
            instanceType: "builtin.database.postgres",
            parameters: { password: "legacy-secret" },
            createdAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
    );
    const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot });
    await assert.rejects(registry.list("u1"), /unsupported connector instance registry version/);
    const legacy = await registry.readLegacy("u1");
    assert.equal(legacy.connectors[0].parameters.password, "legacy-secret");
    await registry.migrateLegacy({
      userId: "u1",
      connectors: legacy.connectors.map(({ parameters: _parameters, ...record }) => ({
        ...record,
        sealedParameters: sealedParameters(),
      })),
    });
    assert.equal((await registry.list("u1"))[0].connectorId, "con_legacy");
    assert.doesNotMatch(await readFile(registryPath, "utf8"), /legacy-secret|password/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
