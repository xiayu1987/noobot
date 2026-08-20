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
import { UserConnectorRegistry } from "../../src/integrations/connectors/registry-store.js";

test("user connector registry isolates owners and persists secrets with owner-only permissions", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registry = new UserConnectorRegistry({ workspaceRoot });
    const created = await registry.create({
      userId: "u1",
      name: "mail",
      type: "email",
      subType: "smtp_imap",
      parameters: {
        smtp_host: "smtp.example.test",
        imap_host: "imap.example.test",
        username: "user@example.test",
        password: "secret",
      },
    });
    assert.equal((await registry.list("u1")).length, 1);
    assert.equal((await registry.list("u2")).length, 0);
    assert.equal(await registry.get({ userId: "u2", connectorId: created.connectorId }), null);

    const registryPath = path.join(
      workspaceRoot,
      "u1",
      "runtime",
      "connectors",
      "connector-registry.json",
    );
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
    assert.match(await readFile(registryPath, "utf8"), /secret/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("sqlite connector paths are resolved inside the owner workspace", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connectors-"));
  try {
    const registry = new UserConnectorRegistry({ workspaceRoot });
    const created = await registry.create({
      userId: "u1",
      name: "local",
      type: "database",
      subType: "sqlite",
      parameters: { file_path: "data/local.sqlite" },
    });
    assert.equal(
      created.parameters.file_path,
      path.join(workspaceRoot, "u1", "data", "local.sqlite"),
    );
    await assert.rejects(
      () =>
        registry.create({
          userId: "u1",
          name: "outside",
          type: "database",
          subType: "sqlite",
          parameters: { file_path: "../outside.sqlite" },
        }),
      /outside user workspace/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
