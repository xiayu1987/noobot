/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServicePluginHost } from "../../services/service-plugin-host.js";

test("service plugin host exposes only the restricted route contract", async () => {
  let receivedContext = null;
  let receivedOptions = null;
  const registerServiceRoutes = async (_app, context, options) => {
    receivedContext = context;
    receivedOptions = options;
    return "registered";
  };
  const runtime = {
    registry: new Map([
      ["demo", {
        pluginId: "demo",
        pluginDir: "/plugins/demo",
        manifest: {
          id: "demo",
          capabilities: ["service.http_routes"],
          runtimeOptions: { "service.http_routes": { priority: 10 } },
        },
        moduleNamespace: { registerServiceRoutes },
      }],
    ]),
  };
  const ports = Object.freeze({ sessions: Object.freeze({ readSnapshot() {} }) });
  const bot = { getWorkspacePath() { throw new Error("must not be exposed"); } };
  const host = createServicePluginHost({ loadPluginRuntime: async () => runtime });

  const result = await host.registerServiceRoutes({ get() {} }, { ports, bot, translateText: () => "" });

  assert.equal(result.length, 1);
  assert.equal(result[0].result, "registered");
  assert.equal(receivedContext.ports, ports);
  assert.equal("bot" in receivedContext, false);
  assert.deepEqual(Object.keys(receivedContext).sort(), [
    "createJsonRouteWrapper", "jsonRoute", "plugin", "ports", "translateText",
  ]);
  assert.deepEqual(receivedOptions, { priority: 10 });
});

test("service plugin host ignores plugins without the route capability", async () => {
  let called = false;
  const runtime = {
    registry: new Map([["demo", {
      pluginId: "demo",
      manifest: { id: "demo", capabilities: ["agent.register"] },
      moduleNamespace: { registerServiceRoutes() { called = true; } },
    }]]),
  };
  const host = createServicePluginHost({ loadPluginRuntime: async () => runtime });
  const result = await host.registerServiceRoutes({ get() {} }, { ports: {} });
  assert.deepEqual(result, []);
  assert.equal(called, false);
});
