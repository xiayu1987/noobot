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
    assert.throws(() => loadConfig(configPath), { code: "CONFIG_FILE_CORRUPTED" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
