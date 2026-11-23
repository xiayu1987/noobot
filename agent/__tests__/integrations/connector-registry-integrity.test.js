/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemConnectorInstanceRepository } from "../../src/session/repositories/file-system-connector-instance-repository.js";

const now = "2026-08-20T00:00:00.000Z";
const record = {
  connectorId: "con_original",
  ownerUserId: "u1",
  name: "original",
  instanceType: "builtin.database.sqlite",
  sealedParameters: {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: "aXY=",
    tag: "dGFn",
    ciphertext: "c2VhbGVk",
  },
  createdAt: now,
  updatedAt: now,
};

async function fixture(t, payload) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-registry-integrity-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const file = path.join(workspaceRoot, "u1", "runtime", "connectors", "connector-instances.json");
  await mkdir(path.dirname(file), { recursive: true });
  const original = JSON.stringify(payload);
  await writeFile(file, original);
  return { registry: new FileSystemConnectorInstanceRepository({ workspaceRoot }), file, original };
}

const creation = {
  userId: "u1",
  connectorId: "con_new",
  name: "new",
  instanceType: record.instanceType,
  sealedParameters: record.sealedParameters,
  now,
};

for (const [label, payload] of [
  ["missing records", { version: 3 }],
  ["non-array records", { version: 3, connectors: {} }],
  ["missing identity", { version: 3, connectors: [{ ...record, connectorId: "" }] }],
  ["foreign owner", { version: 3, connectors: [{ ...record, ownerUserId: "u2" }] }],
  ["duplicate ids", { version: 3, connectors: [record, { ...record, name: "other" }] }],
  ["duplicate names", { version: 3, connectors: [record, { ...record, connectorId: "other" }] }],
  ["missing time", { version: 3, connectors: [{ ...record, createdAt: undefined }] }],
  ["coerced version", { version: "3", connectors: [record] }],
]) {
  test(`connector registry rejects ${label} without replacing source bytes`, async (t) => {
    const { registry, file, original } = await fixture(t, payload);
    await assert.rejects(registry.list("u1"), TypeError);
    await assert.rejects(registry.create(creation), TypeError);
    await assert.rejects(
      registry.update({ ...creation, connectorId: record.connectorId }),
      TypeError,
    );
    await assert.rejects(
      registry.delete({ userId: "u1", connectorId: record.connectorId }),
      TypeError,
    );
    await assert.rejects(registry.readLegacy("u1"), TypeError);
    assert.equal(await readFile(file, "utf8"), original);
  });
}

test("connector creation rejects duplicate identity and permits the next valid write", async (t) => {
  const { registry, file, original } = await fixture(t, { version: 3, connectors: [record] });
  await assert.rejects(
    registry.create({ ...creation, connectorId: record.connectorId }),
    /connectorId already exists/,
  );
  assert.equal(await readFile(file, "utf8"), original);
  await registry.create(creation);
  assert.equal((await registry.list("u1")).length, 2);
});

for (const [label, change] of [
  ["missing records", () => []],
  ["changed identity", () => [{ ...record, connectorId: "con_other" }]],
  ["changed name", () => [{ ...record, name: "renamed" }]],
  ["foreign owner", () => [{ ...record, ownerUserId: "u2" }]],
]) {
  test(`connector migration rejects ${label} and preserves the legacy source`, async (t) => {
    const { sealedParameters: _sealed, ...identity } = record;
    const { registry, file, original } = await fixture(t, {
      version: 2,
      connectors: [{ ...identity, parameters: { database: "example" } }],
    });
    await assert.rejects(registry.migrateLegacy({ userId: "u1", connectors: change() }), TypeError);
    assert.equal(await readFile(file, "utf8"), original);
    await registry.migrateLegacy({ userId: "u1", connectors: [record] });
    assert.deepEqual(await registry.list("u1"), [record]);
  });
}

for (const payload of [
  { version: 2 },
  { version: 2, connectors: [{ ...record, parameters: null }] },
  { version: 99, connectors: [] },
]) {
  test("legacy registry rejects invalid source instead of authorizing an empty migration", async (t) => {
    const { registry, file, original } = await fixture(t, payload);
    await assert.rejects(registry.readLegacy("u1"), TypeError);
    await assert.rejects(registry.migrateLegacy({ userId: "u1", connectors: [] }), TypeError);
    assert.equal(await readFile(file, "utf8"), original);
  });
}
