/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServicePluginHost } from "../../services/service-plugin-host.js";

function serviceEntry({ activate, routes = [], hooks = [] } = {}) {
  const manifest = {
    protocolVersion: 2,
    id: "demo",
    name: "demo",
    version: "1.0.0",
    entries: { service: "service.mjs" },
    contributes: { service: { hooks: { registers: hooks, emits: [] }, routes } },
    requires: { ports: ["hooks.register", "routes.bind"], permissions: [], authenticatedRoutes: [] },
    enabledByDefault: true,
  };
  return { pluginId: "demo", manifest, surface: "service", activate };
}

test("service plugin host binds declared routes without exposing Express", async () => {
  let receivedHost;
  const entry = serviceEntry({
    routes: [{ id: "demo.detail", method: "GET", paths: ["/demo/:id"], auth: "connected_user" }],
    activate(host) {
      receivedHost = host;
      host.routes.bind("demo.detail", (_req, res) => res.json({ ok: true }));
      return { protocolVersion: 2, pluginId: "demo", surface: "service", dispose() {} };
    },
  });
  const registrations = [];
  const app = { get(path, handler) { registrations.push({ path, handler }); } };
  const ports = Object.freeze({ sessions: Object.freeze({ readSnapshot() {} }) });
  const host = createServicePluginHost({ loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }) });

  const result = await host.registerServiceRoutes(app, { ports, translateText: () => "" });

  assert.equal(result.length, 1);
  assert.equal(receivedHost.ports, ports);
  assert.deepEqual(Object.keys(receivedHost).sort(), ["hooks", "ports", "routes"]);
  assert.deepEqual(registrations.map((item) => item.path), ["/demo/:id"]);
});

test("service plugin host rejects an undeclared route", async () => {
  const entry = serviceEntry({
    activate(host) {
      host.routes.bind("demo.hidden", () => {});
      return { protocolVersion: 2, pluginId: "demo", surface: "service" };
    },
  });
  const host = createServicePluginHost({ loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }) });
  await assert.rejects(() => host.registerServiceRoutes({ get() {} }, { ports: {} }), /did not declare route/);
});

test("service plugin host loads the service surface from the configured plugin root", async () => {
  const calls = [];
  const pluginRootDir = "/packaged/backend/plugin";
  const host = createServicePluginHost({
    pluginRootDir,
    loadPluginRuntime: async (options) => {
      calls.push(options);
      return { registry: new Map(), errors: [] };
    },
  });
  await host.registerServiceRoutes({ get() {} }, { ports: {} });
  assert.deepEqual(calls, [{ surface: "service", pluginRootDir }]);
});
