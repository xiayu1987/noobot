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
  createPluginActivationScopeSync,
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
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      protocolVersion: 2,
      id: "example",
      name: "example",
      version: "1.0.0",
      entries: { agent: "agent.mjs" },
      contributes: {
        agent: {
          hooks: { registers: [{ id: "before-turn", point: "agent.before_turn" }], emits: [] },
        },
      },
      requires: { ports: ["hooks.register"], permissions: [], authenticatedRoutes: [] },
      enabledByDefault: true,
    }),
  );
  await writeFile(
    path.join(pluginDir, "agent.mjs"),
    `export function activate(){return {protocolVersion:2,pluginId:"example",surface:"agent",dispose(){}}}`,
  );
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

test("capability facade freezes owned containers without freezing host-owned capabilities", () => {
  const logger = { info() {} };
  const service = { read() {} };
  const publicContext = { metadata: { name: "demo" }, logger };
  const entry = {
    pluginId: "example",
    surface: "service",
    manifest: { requires: { ports: ["service.sessions.read"] } },
  };
  const host = createPluginHostFacade({
    entry,
    publicContext,
    capabilityAdapters: {
      "service.sessions.read": { path: ["services", "sessions"], value: service },
    },
  });

  assert.equal(Object.isFrozen(host), true);
  assert.equal(Object.isFrozen(publicContext.metadata), false);
  assert.equal(Object.isFrozen(logger), false);
  assert.equal(host.metadata, publicContext.metadata);
  assert.equal(host.logger, logger);
  assert.equal(host.services.sessions, service);
  assert.equal(Object.isFrozen(host.services), true);
  assert.equal(Object.isFrozen(service), false);
});

test("capability facade rejects paths that would mutate public context", () => {
  const entry = {
    pluginId: "example",
    surface: "service",
    manifest: { requires: { ports: ["service.sessions.read"] } },
  };
  assert.throws(
    () =>
      createPluginHostFacade({
        entry,
        publicContext: { services: {} },
        capabilityAdapters: {
          "service.sessions.read": { path: ["services", "sessions"], value: {} },
        },
      }),
    /conflicts with public context/,
  );
});

test("capability facade defines dynamic path segments without invoking object prototype setters", () => {
  const entry = {
    pluginId: "example",
    surface: "service",
    manifest: { requires: { ports: ["service.sessions.read"] } },
  };
  const host = createPluginHostFacade({
    entry,
    capabilityAdapters: {
      "service.sessions.read": { path: ["__proto__", "polluted"], value: "owned" },
    },
  });
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.hasOwn(host, "__proto__"), true);
  assert.equal(host.__proto__.polluted, "owned");
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
      return {
        protocolVersion: 2,
        pluginId,
        surface: "service",
        dispose: () => calls.push(`dispose:${pluginId}`),
      };
    },
  });
  await assert.rejects(
    () =>
      createPluginActivationScope({
        entries: [entry("one"), entry("two", true)],
        hostFactory: () => Object.freeze({}),
        transactionFactory: (item) =>
          createContributionTransaction({
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

test("activation rollback attempts every plugin once and preserves the activation failure", async () => {
  const calls = [];
  const entry = (pluginId, fail = false) => ({
    pluginId,
    surface: "service",
    manifest: { id: pluginId, version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      if (fail) throw new Error("activation failed");
      return {
        protocolVersion: 2,
        pluginId,
        surface: "service",
        dispose() {
          calls.push(`dispose:${pluginId}`);
          if (pluginId === "two") throw new Error("dispose failed");
        },
      };
    },
  });

  let error;
  try {
    await createPluginActivationScope({
      entries: [entry("one"), entry("two"), entry("three", true)],
      hostFactory: () => Object.freeze({}),
      transactionFactory: (item) =>
        createContributionTransaction({
          commit() {},
          rollback() {
            calls.push(`rollback:${item.pluginId}`);
            if (item.pluginId === "one") throw new Error("rollback failed");
          },
        }),
    });
  } catch (caught) {
    error = caught;
  }

  assert.equal(error instanceof AggregateError, true);
  assert.equal(error.cause?.message, "activation failed");
  assert.deepEqual(calls, [
    "rollback:three",
    "rollback:two",
    "dispose:two",
    "rollback:one",
    "dispose:one",
  ]);
});

test("scope disposal is failure-isolated, terminal, and records deactivation", async () => {
  const calls = [];
  const entries = ["one", "two"].map((pluginId) => ({
    pluginId,
    surface: "service",
    manifest: { id: pluginId, version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      return {
        protocolVersion: 2,
        pluginId,
        surface: "service",
        dispose() {
          calls.push(`dispose:${pluginId}`);
          if (pluginId === "two") throw new Error("dispose failed");
        },
      };
    },
  }));
  const scope = await createPluginActivationScope({
    entries,
    hostFactory: () => Object.freeze({}),
    transactionFactory: (entry) =>
      createContributionTransaction({
        commit() {},
        rollback() {
          calls.push(`rollback:${entry.pluginId}`);
        },
      }),
  });

  await assert.rejects(() => scope.dispose(), /dispose failed/);
  await assert.rejects(() => scope.dispose(), /dispose failed/);
  assert.equal(scope.disposed, true);
  assert.deepEqual(calls, ["rollback:two", "dispose:two", "rollback:one", "dispose:one"]);
  assert.equal(scope.getActivation("one"), undefined);
  assert.equal(
    scope.lifecycleEvents.filter((event) => event.event === "plugin.deactivated").length,
    1,
  );
  assert.equal(scope.lifecycleEvents.filter((event) => event.event === "plugin.failed").length, 1);
});

test("synchronous scope disposal attempts every plugin exactly once after failure", () => {
  const calls = [];
  const entries = ["one", "two"].map((pluginId) => ({
    pluginId,
    surface: "service",
    manifest: { id: pluginId, version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      return {
        protocolVersion: 2,
        pluginId,
        surface: "service",
        dispose() {
          calls.push(pluginId);
          if (pluginId === "two") throw new Error("sync dispose failed");
        },
      };
    },
  }));
  const scope = createPluginActivationScopeSync({ entries, hostFactory: () => Object.freeze({}) });
  assert.throws(() => scope.dispose(), /sync dispose failed/);
  scope.dispose();
  assert.deepEqual(calls, ["two", "one"]);
});

test("lifecycle reporting failures do not interrupt scope cleanup", async () => {
  const calls = [];
  const entries = ["one", "two"].map((pluginId) => ({
    pluginId,
    surface: "service",
    manifest: { id: pluginId, version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      return {
        protocolVersion: 2,
        pluginId,
        surface: "service",
        dispose() {
          calls.push(pluginId);
        },
      };
    },
  }));
  const scope = await createPluginActivationScope({
    entries,
    hostFactory: () => Object.freeze({}),
    lifecycleSink(record) {
      if (record.event === "plugin.deactivating" && record.pluginId === "two") {
        throw new Error("lifecycle sink failed");
      }
    },
  });

  await assert.rejects(() => scope.dispose(), /lifecycle sink failed/);
  assert.deepEqual(calls, ["two", "one"]);
  await assert.rejects(() => scope.dispose(), /lifecycle sink failed/);
  assert.deepEqual(calls, ["two", "one"]);
});

test("concurrent asynchronous disposal shares one completion and one failure", async () => {
  let release;
  let disposalCalls = 0;
  const entry = {
    pluginId: "one",
    surface: "service",
    manifest: { id: "one", version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      return {
        protocolVersion: 2,
        pluginId: "one",
        surface: "service",
        dispose() {
          disposalCalls += 1;
          return new Promise((_, reject) => {
            release = () => reject(new Error("cleanup failed"));
          });
        },
      };
    },
  };
  const scope = await createPluginActivationScope({
    entries: [entry],
    hostFactory: () => Object.freeze({}),
  });
  const first = scope.dispose();
  const second = scope.dispose();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await assert.rejects(() => first, /cleanup failed/);
  await assert.rejects(() => second, /cleanup failed/);
  assert.equal(disposalCalls, 1);
});

test("scope disposal preserves a primary failure when cleanup also fails", async () => {
  const entry = {
    pluginId: "one",
    surface: "service",
    manifest: { id: "one", version: "1.0.0", protocolVersion: 2, requires: { ports: [] } },
    activate() {
      return {
        protocolVersion: 2,
        pluginId: "one",
        surface: "service",
        dispose() {
          throw new Error("cleanup failed");
        },
      };
    },
  };
  const scope = await createPluginActivationScope({
    entries: [entry],
    hostFactory: () => Object.freeze({}),
  });
  const primary = new Error("publication failed");
  let error;
  try {
    await scope.dispose({ cause: primary });
  } catch (caught) {
    error = caught;
  }
  assert.equal(error instanceof AggregateError, true);
  assert.equal(error.cause, primary);
  assert.deepEqual(
    error.errors.map((item) => item.message),
    ["publication failed", "cleanup failed"],
  );
});

test("runtime rejects legacy manifests instead of translating them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-plugin-runtime-legacy-"));
  const pluginDir = path.join(root, "legacy");
  await mkdir(pluginDir);
  await writeFile(
    path.join(pluginDir, "manifest.json"),
    JSON.stringify({
      id: "legacy",
      name: "legacy",
      version: "1.0.0",
      apiVersion: "1",
      capabilities: ["agent.register"],
      entries: { agent: "agent.mjs" },
      enabledByDefault: true,
    }),
  );
  await writeFile(path.join(pluginDir, "agent.mjs"), "export function registerNoobotPlugin(){}\n");
  const runtime = await loadNoobotPlugins({ pluginRootDir: root, surface: "agent" });
  assert.equal(runtime.loadedCount, 0);
  assert.match(runtime.errors[0].message, /protocolVersion|unrecognized/i);
});
