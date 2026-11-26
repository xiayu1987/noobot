/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConnectorSecretVault } from "../security/connector-secret-vault.js";
import {
  assertPrivateStoragePermissions,
  grantPublicReadForTest,
} from "../../platform-compatibility/__tests__/helpers/private-storage.js";

const identity = {
  userId: "alice",
  connectorId: "con_database",
  instanceType: "builtin.database.postgres",
};

test("connector secret vault encrypts parameters with a connect-code-wrapped user key", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connector-vault-"));
  try {
    const vault = new ConnectorSecretVault({ workspaceRoot });
    await vault.unlockUser({ userId: "alice", connectCode: "correct-code" });
    const sealedParameters = vault.seal({
      ...identity,
      parameters: { host: "database.internal", password: "plain-secret" },
    });
    assert.equal(
      JSON.stringify(sealedParameters).includes("plain-secret"),
      false,
      "the envelope must not contain plaintext",
    );
    assert.deepEqual(vault.unseal({ ...identity, sealedParameters }), {
      host: "database.internal",
      password: "plain-secret",
    });

    const keyDocument = await readFile(
      path.join(workspaceRoot, "alice", "runtime", "connectors", "connector-key.json"),
      "utf8",
    );
    assert.equal(keyDocument.includes("correct-code"), false);
    assert.equal(keyDocument.includes("plain-secret"), false);
    await assertPrivateStoragePermissions(
      path.join(workspaceRoot, "alice", "runtime", "connectors", "connector-key.json"),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("connector secret vault rejects a wrong code and binds ciphertext to connector identity", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connector-vault-"));
  try {
    const vault = new ConnectorSecretVault({ workspaceRoot });
    await vault.unlockUser({ userId: "alice", connectCode: "correct-code" });
    const sealedParameters = vault.seal({ ...identity, parameters: { password: "secret" } });
    vault.lockUser("alice");
    await assert.rejects(vault.unlockUser({ userId: "alice", connectCode: "wrong-code" }), {
      code: "connector_secret_unlock_failed",
    });
    await vault.unlockUser({ userId: "alice", connectCode: "correct-code" });
    assert.throws(() => vault.unseal({ ...identity, connectorId: "con_other", sealedParameters }), {
      code: "connector_secret_decrypt_failed",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("connector secret vault restricts an old key on unlock without rewriting its bytes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connector-old-key-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const vault = new ConnectorSecretVault({ workspaceRoot });
  await vault.unlockUser({ userId: "alice", connectCode: "correct-code" });
  const sealedParameters = vault.seal({ ...identity, parameters: { password: "synthetic" } });
  const keyPath = path.join(workspaceRoot, "alice", "runtime", "connectors", "connector-key.json");
  const before = await readFile(keyPath);
  vault.lockUser("alice");
  await grantPublicReadForTest(keyPath);
  await assert.rejects(assertPrivateStoragePermissions(keyPath));
  await vault.unlockUser({ userId: "alice", connectCode: "correct-code" });
  await assertPrivateStoragePermissions(keyPath);
  assert.deepEqual(await readFile(keyPath), before);
  assert.deepEqual(vault.unseal({ ...identity, sealedParameters }), { password: "synthetic" });
});

test("connector secret vault rotates only the connect-code key wrapping", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-connector-vault-"));
  try {
    const vault = new ConnectorSecretVault({ workspaceRoot });
    await vault.unlockUser({ userId: "alice", connectCode: "old-code" });
    const sealedParameters = vault.seal({ ...identity, parameters: { password: "secret" } });
    await vault.rotateUserKey({
      userId: "alice",
      oldConnectCode: "old-code",
      newConnectCode: "new-code",
    });
    vault.lockUser("alice");
    await assert.rejects(vault.unlockUser({ userId: "alice", connectCode: "old-code" }), {
      code: "connector_secret_unlock_failed",
    });
    await vault.unlockUser({ userId: "alice", connectCode: "new-code" });
    assert.deepEqual(vault.unseal({ ...identity, sealedParameters }), { password: "secret" });
    await assertPrivateStoragePermissions(
      path.join(workspaceRoot, "alice", "runtime", "connectors", "connector-key.json"),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
