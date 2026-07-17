/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { createConfigParamsService } from "../services/config-params-service.js";

async function createTempDir(prefix = "noobot-config-params-test-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

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
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function serviceConfigEventFile(workspaceRoot) {
  return path.join(workspaceRoot, "system", "runtime", "events", "system", "service", "config.jsonl");
}

test("collectConfigTemplateKeys: 只收集大写模板变量", async () => {
  const tempDir = await createTempDir();
  const workspaceRoot = path.join(tempDir, "workspace");
  const templateRoot = path.join(tempDir, "template");
  try {
    await mkdir(templateRoot, { recursive: true });
    await writeFile(
      path.join(templateRoot, "config.json"),
      JSON.stringify({
        provider: {
          api_key: "${API_KEY}",
          lower: "${api_key}",
          mixed: "${Api_Key}",
          url: "${BASE_URL}",
        },
      }),
      "utf8",
    );

    const service = createConfigParamsService({
      workspaceRootPath: () => workspaceRoot,
      templateRootPath: () => templateRoot,
      getGlobalConfigRaw: () => ({
        globalKey: "${GLOBAL_KEY}",
        oldKey: "${global_key}",
      }),
    });

    assert.deepEqual(await service.collectConfigTemplateKeys(), [
      "API_KEY",
      "BASE_URL",
      "GLOBAL_KEY",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("config-params-service: writes sanitized system events for config read failures", async () => {
  const tempDir = await createTempDir();
  const workspaceRoot = path.join(tempDir, "workspace");
  const runtimeRoot = path.join(tempDir, "runtime-root");
  const templateRoot = path.join(tempDir, "template");
  try {
    await mkdir(path.join(workspaceRoot, "user-secret-token"), { recursive: true });
    await mkdir(templateRoot, { recursive: true });
    await writeFile(path.join(workspaceRoot, "config-params.json"), "{ invalid SECRET_VALUE", "utf8");
    await writeFile(path.join(workspaceRoot, "user-secret-token", "config-params.json"), "{ invalid APIKEY", "utf8");
    await writeFile(path.join(templateRoot, "config.json"), "{ invalid TOKEN", "utf8");

    const service = createConfigParamsService({
      workspaceRootPath: () => workspaceRoot,
      templateRootPath: () => templateRoot,
      getGlobalConfigRaw: () => ({ provider: "${API_KEY}" }),
      runtimeEventsConfig: { workspaceRoot: runtimeRoot },
    });

    assert.deepEqual(await service.readWorkspaceConfigParams(), { values: {}, descriptions: {} });
    assert.deepEqual(await service.readUserConfigParams({ userId: "user-secret-token" }), { values: {}, descriptions: {} });
    assert.deepEqual(await service.collectConfigTemplateKeys(), ["API_KEY"]);

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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
