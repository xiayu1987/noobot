/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  activateLoadedNoobotPlugin,
  loadNoobotPlugins,
  resolveLoadedNoobotPlugin,
} from "../src/index.js";

test("runtime loads only Manifest V2 activate entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-plugin-runtime-"));
  const pluginDir = path.join(root, "example");
  await mkdir(pluginDir);
  await writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify({
    protocolVersion: 2,
    id: "example",
    name: "example",
    version: "1.0.0",
    entries: { agent: "agent.mjs" },
    contributes: { agent: { hooks: { registers: ["agent.before_turn"], emits: [] } } },
    requires: { ports: ["hooks.register"], permissions: [], authenticatedRoutes: [] },
    enabledByDefault: true,
  }));
  await writeFile(path.join(pluginDir, "agent.mjs"), `export function activate(){return {protocolVersion:2,pluginId:"example",surface:"agent",dispose(){}}}`);
  const runtime = await loadNoobotPlugins({ pluginRootDir: root, surface: "agent" });
  assert.equal(runtime.loadedCount, 1);
  assert.equal(runtime.errors.length, 0);
  const entry = resolveLoadedNoobotPlugin(runtime, "example");
  const activation = await activateLoadedNoobotPlugin(entry);
  assert.equal(activation.pluginId, "example");
});

test("runtime rejects legacy manifests instead of translating them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-plugin-runtime-legacy-"));
  const pluginDir = path.join(root, "legacy");
  await mkdir(pluginDir);
  await writeFile(path.join(pluginDir, "manifest.json"), JSON.stringify({
    id: "legacy",
    name: "legacy",
    version: "1.0.0",
    apiVersion: "1",
    capabilities: ["agent.register"],
    entries: { agent: "agent.mjs" },
    enabledByDefault: true,
  }));
  await writeFile(path.join(pluginDir, "agent.mjs"), "export function registerNoobotPlugin(){}\n");
  const runtime = await loadNoobotPlugins({ pluginRootDir: root, surface: "agent" });
  assert.equal(runtime.loadedCount, 0);
  assert.match(runtime.errors[0].message, /protocolVersion|unrecognized/i);
});
