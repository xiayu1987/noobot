/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemConnectorInstanceRepository } from "../../src/session/repositories/file-system-connector-instance-repository.js";
import { getFsAdapter, setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import { assertPrivateStoragePermissions } from "../../../platform-compatibility/__tests__/helpers/private-storage.js";
import { TIME_THRESHOLDS } from "@noobot/shared/time-thresholds";

const execute = promisify(execFile);
const repositoryUrl = new URL(
  "../../src/session/repositories/file-system-connector-instance-repository.js",
  import.meta.url,
).href;
const adapterUrl = new URL("../../src/shared/storage/fs-adapter.js", import.meta.url).href;
const runtimeParamsUrl = new URL("../../../shared/testing/runtime-params.js", import.meta.url).href;
const input = (id) => ({
  userId: "u1",
  connectorId: id,
  name: id,
  instanceType: "builtin.database.sqlite",
  sealedParameters: {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: "aXY=",
    tag: "dGFn",
    ciphertext: "c2VhbGVk",
  },
  now: "2026-08-20T00:00:00.000Z",
});

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-registry-publication-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot });
  await registry.create(input("original"));
  const file = path.join(workspaceRoot, "u1", "runtime", "connectors", "connector-instances.json");
  return { workspaceRoot, registry, file };
}

function writer(workspaceRoot, ids, crash) {
  const workerLifetimeMs = TIME_THRESHOLDS.fileMutation.lockTimeoutMs * (ids.length + 1);
  const source = `
    import { FileSystemConnectorInstanceRepository } from ${JSON.stringify(repositoryUrl)};
    import { getFsAdapter, setFsAdapter } from ${JSON.stringify(adapterUrl)};
    const registry = new FileSystemConnectorInstanceRepository({ workspaceRoot: ${JSON.stringify(workspaceRoot)} });
    const adapter = getFsAdapter();
    const crash = ${JSON.stringify(crash)};
    if (crash) setFsAdapter({ ...adapter, async rename(source, target) {
      if (!target.endsWith("connector-instances.json")) return adapter.rename(source, target);
      if (crash === "after") await adapter.rename(source, target);
      process.exit(44);
    }});
    for (const request of ${JSON.stringify(ids.map(input))}) await registry.create(request);
  `;
  return execute(
    process.execPath,
    ["--import", runtimeParamsUrl, "--input-type=module", "--eval", source],
    { timeout: workerLifetimeMs },
  );
}

test("independent connector writers preserve all acknowledged records", async (t) => {
  const { workspaceRoot, registry } = await fixture(t);
  const groups = Array.from({ length: 3 }, (_, worker) =>
    Array.from({ length: 6 }, (_, item) => `writer_${worker}_${item}`),
  );
  await Promise.all(groups.map((ids) => writer(workspaceRoot, ids, null)));
  assert.deepEqual(
    (await registry.list("u1")).map(({ connectorId }) => connectorId).sort(),
    ["original", ...groups.flat()].sort(),
  );
});

for (const phase of ["before", "after"]) {
  test(`connector publication recovers a process exit ${phase} rename`, async (t) => {
    const { workspaceRoot, registry, file } = await fixture(t);
    await assert.rejects(writer(workspaceRoot, ["interrupted"], phase), { code: 44 });
    const visible = phase === "after" ? ["original", "interrupted"] : ["original"];
    assert.deepEqual(
      (await registry.list("u1")).map(({ connectorId }) => connectorId),
      visible,
    );
    const published = await readFile(file, "utf8");
    assert.equal(JSON.parse(published).connectors.length, visible.length);
    if (phase === "before") await assertPrivateStoragePermissions(`${file}.publication.tmp`);
    await registry.create(input("retry"));
    assert.deepEqual(
      (await registry.list("u1")).map(({ connectorId }) => connectorId),
      [...visible, "retry"],
    );
    await assertPrivateStoragePermissions(file);
    assert.equal(
      (await readdir(path.dirname(file))).some((name) => name.endsWith(".tmp")),
      false,
    );
  });
}

test("connector file sync failure leaves authority intact and releases its mutation lock", async (t) => {
  const { registry, file } = await fixture(t);
  const original = await readFile(file, "utf8");
  const adapter = getFsAdapter();
  t.after(resetFsAdapter);
  setFsAdapter({
    ...adapter,
    async open(target, ...args) {
      const handle = await adapter.open(target, ...args);
      if (target === `${file}.publication.tmp`)
        handle.sync = async () => {
          throw Object.assign(new Error("injected sync failure"), { code: "EIO" });
        };
      return handle;
    },
  });
  await assert.rejects(registry.create(input("failed")), { code: "EIO" });
  assert.equal(await readFile(file, "utf8"), original);
  resetFsAdapter();
  await registry.create(input("retry"));
  assert.deepEqual(
    (await registry.list("u1")).map(({ connectorId }) => connectorId),
    ["original", "retry"],
  );
});
