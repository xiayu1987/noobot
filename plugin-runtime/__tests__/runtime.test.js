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
  createContributionTransaction,
  createPluginActivationScope,
  createExtensionRegistry,
  createPluginHostFacade,
  loadNoobotPlugins,
  resolveLoadedNoobotPlugin,
} from "../src/index.js";

test("extension registry publishes candidate generations atomically", () => {
  const registry = createExtensionRegistry({ pointDefinitions: { point: { strategy: "multi" } } });
  registry.replacePlugin("demo", [{ point: "point", contribution: { id: "old", value: "old" } }]);
  const candidate = registry.createGeneration();
  candidate.replacePlugin("demo", [{ point: "point", contribution: { id: "new", value: "new" } }]);
  assert.equal(registry.list("point")[0].id, "old");
  registry.publish(candidate);
  candidate.removePlugin("demo");
  assert.equal(registry.list("point")[0].id, "new");
});

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
    contributes: { agent: { hooks: { registers: [{ id: "before-turn", point: "agent.before_turn" }], emits: [] } } },
    requires: { ports: ["hooks.register"], permissions: [], authenticatedRoutes: [] },
    enabledByDefault: true,
  }));
  await writeFile(path.join(pluginDir, "agent.mjs"), `export function activate(){return {protocolVersion:2,pluginId:"example",surface:"agent",dispose(){}}}`);
  const runtime = await loadNoobotPlugins({ pluginRootDir: root, surface: "agent" });
  assert.equal(runtime.loadedCount, 1);
  assert.equal(runtime.errors.length, 0);
  const entry = resolveLoadedNoobotPlugin(runtime, "example");
  assert.equal(entry.pluginId, "example");
  assert.equal(typeof entry.activate, "function");
});

test("capability facade exposes only surface-declared host ports", () => {
  const entry = {
    pluginId: "example",
    surface: "service",
    manifest: {
      requires: { ports: ["hooks.register", "routes.bind", "model.invoke"] },
    },
  };
  const host = createPluginHostFacade({
    entry,
    capabilityAdapters: {
      "hooks.register": { path: ["hooks", "register"], value: () => "hook" },
      "routes.bind": { path: ["routes", "bind"], value: () => "route" },
      "model.invoke": { path: ["model", "invoke"], value: () => "model" },
    },
  });
  assert.deepEqual(Object.keys(host).sort(), ["hooks", "routes"]);
  assert.equal(host.hooks.register(), "hook");
  assert.equal(host.routes.bind(), "route");
});

test("activation scope rolls back committed contributions and disposes in reverse order", async () => {
  const calls = [];
  const entry = (pluginId, fail = false) => ({
    pluginId,
    surface: "service",
    manifest: { id: pluginId, version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      calls.push(`activate:${pluginId}`);
      if (fail) throw new Error(`failed:${pluginId}`);
      return { protocolVersion: 2, pluginId, surface: "service", dispose: () => calls.push(`dispose:${pluginId}`) };
    },
  });
  await assert.rejects(
    () => createPluginActivationScope({
      entries: [entry("one"), entry("two", true)],
      hostFactory: () => Object.freeze({}),
      transactionFactory: (item) => createContributionTransaction({
        commit: () => calls.push(`commit:${item.pluginId}`),
        rollback: () => calls.push(`rollback:${item.pluginId}`),
      }),
    }),
    /failed:two/,
  );
  assert.deepEqual(calls, [
    "activate:one",
    "commit:one",
    "activate:two",
    "rollback:two",
    "rollback:one",
    "dispose:one",
  ]);
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
