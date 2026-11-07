/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsPromises, {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";

import { createConfigParamsService } from "../services/config-params-service.js";

async function createTempDir(prefix = "noobot-config-params-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("config params writes reject invalid entries without changing files and recover after correction", async (t) => {
  const workspaceRoot = await createTempDir();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const service = createConfigParamsService({ workspaceRootPath: () => workspaceRoot });
  for (const userId of ["", "admin"]) {
    const save = (input) =>
      userId
        ? service.writeUserConfigParams({ userId, input })
        : service.writeWorkspaceConfigParams(input);
    const filePath = path.join(workspaceRoot, userId, "config-params.json");
    await save({ values: { API_KEY: "original" } });
    const original = await readFile(filePath, "utf8");
    for (const field of ["values", "descriptions"]) {
      for (const value of [{ nested: "private" }, ["a", "b"], null, false, 0]) {
        await assert.rejects(save({ [field]: { API_KEY: value } }), {
          code: "INVALID_CONFIG_PARAM_DOCUMENT",
        });
        assert.equal(await readFile(filePath, "utf8"), original);
      }
    }
    await save({ values: { API_KEY: "corrected" } });
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).values.API_KEY, "corrected");
  }
});

test("config params atomic writes preserve originals and clean temporary files on failure", async (t) => {
  const workspaceRoot = await createTempDir();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const service = createConfigParamsService({ workspaceRootPath: () => workspaceRoot });
  for (const userId of ["", "admin"]) {
    const save = (input) =>
      userId
        ? service.writeUserConfigParams({ userId, input })
        : service.writeWorkspaceConfigParams(input);
    const filePath = path.join(workspaceRoot, userId, "config-params.json");
    await save({ values: { API_KEY: "original" } });
    const original = await readFile(filePath, "utf8");
    const files = await readdir(path.dirname(filePath));
    for (const operation of ["writeFile", "rename"]) {
      const originalWrite = fsPromises.writeFile;
      const fault = Object.assign(new Error("injected storage failure"), { code: "ENOSPC" });
      t.mock.method(fsPromises, operation, async (...args) => {
        if (operation === "writeFile") await originalWrite(args[0], "partial");
        throw fault;
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          save({ values: { API_KEY: "replacement" } }),
          (error) => error === fault,
        );
        assert.equal(await readFile(filePath, "utf8"), original);
        assert.deepEqual(await readdir(path.dirname(filePath)), files);
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    }
    await save({ values: { API_KEY: "recovered" } });
    assert.equal(JSON.parse(await readFile(filePath, "utf8")).values.API_KEY, "recovered");
  }
});

async function waitForFile(file, { timeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function serviceConfigEventFile(workspaceRoot) {
  return path.join(
    workspaceRoot,
    "system",
    "runtime",
    "events",
    "system",
    "service",
    "config.jsonl",
  );
}

test("collectConfigTemplateKeys: 只从全局配置收集大写模板变量", async () => {
  const service = createConfigParamsService({
    workspaceRootPath: () => "/tmp/unused-workspace",
    getGlobalConfigRaw: () => ({
      provider: { api_key: "${API_KEY}", lower: "${api_key}", url: "${BASE_URL}" },
      globalKey: "${GLOBAL_KEY}",
    }),
  });
  assert.deepEqual(await service.collectConfigTemplateKeys(), [
    "API_KEY",
    "BASE_URL",
    "GLOBAL_KEY",
  ]);
});

test("collectUserConfigTemplateKeys: 用户 config.json 缺失或 userId 为空时报错", async () => {
  const tempDir = await createTempDir();
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_WORKSPACE_ROOT = path.join(tempDir, "runtime-root");
  try {
    const service = createConfigParamsService({
      workspaceRootPath: () => path.join(tempDir, "workspace"),
      getGlobalConfigRaw: () => ({}),
    });
    await assert.rejects(service.collectUserConfigTemplateKeys(""), TypeError);
    await assert.rejects(service.collectUserConfigTemplateKeys("u1"), { code: "ENOENT" });
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("config-params-service: rejects invalid documents and writes sanitized system events", async () => {
  const tempDir = await createTempDir();
  const workspaceRoot = path.join(tempDir, "workspace");
  const runtimeRoot = path.join(tempDir, "runtime-root");
  const previousWorkspaceRoot = process.env.NOOBOT_WORKSPACE_ROOT;
  process.env.NOOBOT_WORKSPACE_ROOT = runtimeRoot;
  try {
    await mkdir(path.join(workspaceRoot, "user-secret-token"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, "config-params.json"),
      "{ invalid SECRET_VALUE",
      "utf8",
    );
    await writeFile(
      path.join(workspaceRoot, "user-secret-token", "config-params.json"),
      "{ invalid APIKEY",
      "utf8",
    );
    await writeFile(
      path.join(workspaceRoot, "user-secret-token", "config.json"),
      "{ invalid TOKEN",
      "utf8",
    );

    const service = createConfigParamsService({
      workspaceRootPath: () => workspaceRoot,
      getGlobalConfigRaw: () => ({ provider: "${API_KEY}" }),
    });

    const invalidDocument = {
      code: "INVALID_CONFIG_DOCUMENT",
      details: {
        code: "INVALID_CONFIG_DOCUMENT",
        impact: "document",
        autoRepair: false,
        path: "$",
      },
    };
    await assert.rejects(
      service.readWorkspaceConfigParams({ createIfMissing: true }),
      invalidDocument,
    );
    await assert.rejects(
      service.readUserConfigParams({ userId: "user-secret-token", createIfMissing: true }),
      invalidDocument,
    );
    await assert.rejects(
      service.collectUserConfigTemplateKeys("user-secret-token"),
      invalidDocument,
    );

    const eventFile = serviceConfigEventFile(runtimeRoot);
    await waitForFile(eventFile);
    const records = await readJsonl(eventFile);
    const events = records.map((record) => record.event).sort();

    assert.deepEqual(events, [
      "service.configParams.configJson.read.failed",
      "service.configParams.user.read.failed",
      "service.configParams.workspace.read.failed",
    ]);
    for (const record of records) {
      assert.equal(record.scope, "system");
      assert.equal(record.source, "service");
      assert.equal(record.category, "config");
      assert.equal(record.level, "warn");
      assert.equal(record.channel, "direct");
      assert.equal(Object.prototype.hasOwnProperty.call(record, "sessionId"), false);
      assert.equal(typeof record.data.fileName, "string");
      assert.equal(typeof record.data.filePathLength, "number");
      assert.ok(record.error);
    }

    const serialized = JSON.stringify(records);
    assert.equal(serialized.includes("SECRET_VALUE"), false);
    assert.equal(serialized.includes("APIKEY"), false);
    assert.equal(serialized.includes("TOKEN"), false);
    assert.equal(serialized.includes("user-secret-token"), false);
    assert.equal(
      await readFile(path.join(workspaceRoot, "config-params.json"), "utf8"),
      "{ invalid SECRET_VALUE",
    );
    assert.equal(
      await readFile(path.join(workspaceRoot, "user-secret-token/config-params.json"), "utf8"),
      "{ invalid APIKEY",
    );
    await service.writeWorkspaceConfigParams({ values: { API_KEY: "workspace-corrected" } });
    await service.writeUserConfigParams({
      userId: "user-secret-token",
      input: { values: { API_KEY: "user-corrected" } },
    });
    assert.equal((await service.readWorkspaceConfigParams()).values.API_KEY, "workspace-corrected");
    assert.equal(
      (await service.readUserConfigParams({ userId: "user-secret-token" })).values.API_KEY,
      "user-corrected",
    );
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.NOOBOT_WORKSPACE_ROOT;
    else process.env.NOOBOT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("config-params-service delegates document and catalog semantics to the protocol", () => {
  const service = createConfigParamsService({ workspaceRootPath: () => "/tmp/workspace" });
  assert.deepEqual(
    service.normalizeConfigParams({
      values: { api_key: " key " },
      descriptions: { api_key: " Credential " },
    }),
    {
      values: { API_KEY: "key" },
      descriptions: { API_KEY: "Credential" },
    },
  );
  assert.deepEqual(
    service.buildConfigParamCatalog({
      values: { api_key: "key" },
      descriptions: { region: " Region " },
    }),
    [
      { key: "API_KEY", description: "" },
      { key: "REGION", description: "Region" },
    ],
  );
  assert.deepEqual(
    service.buildConfigParamCatalog({
      keys: ["API_KEY"],
      values: { UNUSED_KEY: "value" },
    }),
    [
      { key: "API_KEY", description: "" },
      { key: "UNUSED_KEY", description: "" },
    ],
  );
});
