/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CONFIG_FILE_ERROR_CODE } from "@noobot/shared/config-file";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";

test("model proxy config uses defaults only for a missing optional file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-proxy-config-"));
  try {
    assert.deepEqual(loadConfig(path.join(root, "missing.json")), DEFAULT_CONFIG);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model proxy config fails closed when the configured JSON is malformed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-proxy-config-"));
  try {
    const configPath = path.join(root, "config.json");
    await writeFile(configPath, "{broken", "utf8");
    assert.throws(() => loadConfig(configPath), { code: CONFIG_FILE_ERROR_CODE.CORRUPTED });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model proxy config requires log thresholds to use the runtime parameter store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-proxy-config-"));
  try {
    for (const key of ["maxLogFileSizeBytes", "retainMs"]) {
      const configPath = path.join(root, `${key}.json`);
      await writeFile(configPath, JSON.stringify({ [key]: 1 }), "utf8");
      assert.throws(() => loadConfig(configPath), {
        message: `${key} was moved to workspace/runtime-params.json; remove it from model-proxy.config.json`,
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model proxy rejects invalid configuration instead of substituting or skipping entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-model-proxy-config-"));
  try {
    const configPath = path.join(root, "config.json");
    const proxy = { localPort: 12341, targetUrl: "https://example.com" };
    for (const config of [
      { proxyHost: "" },
      { logDir: null },
      { proxies: [] },
      { proxies: [null] },
      { proxies: [{ ...proxy, localPort: 0 }] },
      { proxies: [{ ...proxy, localPort: "12341" }] },
      { proxies: [{ ...proxy, localPort: 65536 }] },
      { proxies: [{ ...proxy, targetUrl: "not a URL" }] },
      { proxies: [{ ...proxy, targetUrl: "file:///tmp/file" }] },
      { proxies: [proxy, proxy] },
    ]) {
      await writeFile(configPath, JSON.stringify(config));
      assert.throws(() => loadConfig(configPath), JSON.stringify(config));
    }
    await writeFile(configPath, JSON.stringify({ proxies: [proxy], logPrefix: "custom" }));
    assert.deepEqual(loadConfig(configPath).proxies, [proxy]);
    assert.equal(loadConfig(configPath).logPrefix, "custom");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
