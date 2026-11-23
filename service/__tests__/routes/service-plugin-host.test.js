/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServicePluginHost } from "../../services/service-plugin-host.js";
import { createServiceBotAccess } from "../../services/service-bot-access.js";
import { express, withTestServer } from "./session-routes.helpers.js";
const enforceUserScopeParam = (_req, _res, next) => next();
const runBotOperation = (operation) => operation();

function serviceEntry({
  activate,
  routes = [],
  hooks = [],
  ports = ["hooks.register", "routes.bind"],
} = {}) {
  const permissions = [];
  if (ports.includes("service.sessions.read")) permissions.push("session.read");
  if (ports.includes("service.workspace.assets")) permissions.push("workspace.asset.manage");
  const manifest = {
    protocolVersion: 2,
    id: "demo",
    name: "demo",
    version: "1.0.0",
    entries: { service: "service.mjs" },
    contributes: {
      service: {
        hooks: { registers: hooks.map((point) => ({ id: `test.${point}`, point })), emits: [] },
        routes,
      },
    },
    requires: { ports, permissions, authenticatedRoutes: [] },
    enabledByDefault: true,
  };
  return { pluginId: "demo", manifest, surface: "service", activate };
}

test("plugin HTTP operations retain their runtime across awaits and reject retirement admission", async (t) => {
  const entered = Promise.withResolvers();
  const resume = Promise.withResolvers();
  t.after(() => resume.resolve());
  const previous = { session: { revision: 1 } };
  let current = previous;
  let closed = false;
  const access = createServiceBotAccess({ getBot: () => current });
  const entry = serviceEntry({
    routes: [{ id: "demo.detail", method: "GET", paths: ["/demo"], auth: "connected_user" }],
    activate(host) {
      host.routes.bind("demo.detail", async (_req, res) => {
        const before = access.session;
        entered.resolve();
        await resume.promise;
        assert.equal(closed, false);
        assert.equal(access.session, before);
        return res.json({ revision: access.session.revision });
      });
      return { protocolVersion: 2, pluginId: "demo", surface: "service" };
    },
  });
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }),
  });
  t.after(() => host.dispose());
  const app = express();
  await host.registerServiceRoutes(app, {
    enforceUserScopeParam,
    runBotOperation: access.runOperation,
  });
  await withTestServer(app, async (baseUrl) => {
    const pending = fetch(`${baseUrl}/demo`);
    await entered.promise;
    const retirement = access.withRetirement(() => {
      closed = true;
      current = { session: { revision: 2 } };
    });
    try {
      const rejected = await fetch(`${baseUrl}/demo`);
      assert.equal(rejected.status, 503);
      assert.equal((await rejected.json()).errorCode, "RUNTIME_CLOSED");
      assert.equal(closed, false);
    } finally {
      resume.resolve();
    }
    assert.deepEqual(await (await pending).json(), { revision: 1 });
    await retirement;
    assert.equal(closed, true);
    assert.equal(access.session.revision, 2);
  });
});

test("service plugin routes require an explicit operation retention boundary", async () => {
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map(), errors: [] }),
  });
  await assert.rejects(
    host.registerServiceRoutes({ use() {} }, { enforceUserScopeParam }),
    /runBotOperation/,
  );
  await host.dispose();
});

test("service plugin host binds declared routes without exposing Express", async () => {
  let receivedHost;
  const entry = serviceEntry({
    ports: ["hooks.register", "routes.bind", "service.sessions.read"],
    routes: [{ id: "demo.detail", method: "GET", paths: ["/demo/:id"], auth: "connected_user" }],
    activate(host) {
      receivedHost = host;
      host.routes.bind("demo.detail", (_req, res) => res.json({ ok: true }));
      return { protocolVersion: 2, pluginId: "demo", surface: "service", dispose() {} };
    },
  });
  const registrations = [];
  const app = {
    use(handler) {
      registrations.push({ handler });
    },
  };
  const scopedSessions = Object.freeze({ readSnapshot() {} });
  const sessionScopes = [];
  const ports = Object.freeze({
    sessions: Object.freeze({
      forPlugin(manifest) {
        sessionScopes.push(manifest);
        return scopedSessions;
      },
    }),
  });
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }),
  });

  const result = await host.registerServiceRoutes(app, {
    ports,
    translateText: () => "",
    enforceUserScopeParam,
    runBotOperation,
  });

  assert.equal(result.length, 1);
  assert.equal(receivedHost.ports.sessions, scopedSessions);
  assert.deepEqual(sessionScopes, [entry.manifest]);
  assert.equal(receivedHost.ports.http, undefined);
  assert.deepEqual(Object.keys(receivedHost).sort(), ["hooks", "ports", "routes"]);
  assert.equal(registrations.length, 1);
});

test("service plugin host scopes the workspace asset port to plugin identity", async () => {
  let receivedPort;
  const entry = serviceEntry({
    ports: ["hooks.register", "service.workspace.assets"],
    activate(host) {
      receivedPort = host.ports.workspaceAssets;
      return { protocolVersion: 2, pluginId: "demo", surface: "service" };
    },
  });
  const scoped = Object.freeze({ read() {}, write() {} });
  const forPlugin = (pluginId) => (pluginId === "demo" ? scoped : null);
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }),
  });

  await host.registerServiceRoutes(
    { use() {} },
    { ports: { workspaceAssets: { forPlugin } }, enforceUserScopeParam, runBotOperation },
  );

  assert.equal(receivedPort, scoped);
});

test("service plugin host rejects an undeclared route", async () => {
  const entry = serviceEntry({
    activate(host) {
      host.routes.bind("demo.hidden", () => {});
      return { protocolVersion: 2, pluginId: "demo", surface: "service" };
    },
  });
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", entry]]), errors: [] }),
  });
  await assert.rejects(
    () =>
      host.registerServiceRoutes(
        { use() {} },
        { ports: {}, enforceUserScopeParam, runBotOperation },
      ),
    /did not declare route/,
  );
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
  await host.registerServiceRoutes(
    { use() {} },
    { ports: {}, enforceUserScopeParam, runBotOperation },
  );
  assert.deepEqual(calls, [{ surface: "service", pluginRootDir }]);
});

function runtimeWithActivation(activate) {
  const entry = serviceEntry({ ports: ["hooks.register"], activate });
  return { registry: new Map([["demo", entry]]), errors: [] };
}

function successfulActivation(dispose) {
  return () => ({ protocolVersion: 2, pluginId: "demo", surface: "service", dispose });
}

test("failed refresh preserves the committed generation and disposes it only when the host closes", async () => {
  let activeDisposals = 0;
  const host = createServicePluginHost({
    loadPluginRuntime: async () =>
      runtimeWithActivation(
        successfulActivation(() => {
          activeDisposals += 1;
        }),
      ),
    refreshPluginRuntime: async () =>
      runtimeWithActivation(() => {
        throw new Error("candidate failed");
      }),
  });
  const app = { use() {} };

  await host.registerServiceRoutes(app, { ports: {}, enforceUserScopeParam, runBotOperation });
  await assert.rejects(() => host.refresh(), /candidate failed/);
  assert.equal(activeDisposals, 0);

  await host.dispose();
  assert.equal(activeDisposals, 1);
});

test("successful refresh releases the previous scope exactly once", async () => {
  let previousDisposals = 0;
  let currentDisposals = 0;
  const host = createServicePluginHost({
    loadPluginRuntime: async () =>
      runtimeWithActivation(
        successfulActivation(() => {
          previousDisposals += 1;
        }),
      ),
    refreshPluginRuntime: async () =>
      runtimeWithActivation(
        successfulActivation(() => {
          currentDisposals += 1;
        }),
      ),
  });

  await host.registerServiceRoutes(
    { use() {} },
    { ports: {}, enforceUserScopeParam, runBotOperation },
  );
  await host.refresh();
  assert.equal(previousDisposals, 1);
  assert.equal(currentDisposals, 0);

  await host.dispose();
  assert.equal(previousDisposals, 1);
  assert.equal(currentDisposals, 1);
});

test("concurrent refreshes commit in request order without an older generation overwriting a newer one", async () => {
  const refreshResolvers = [];
  const disposalCounts = [0, 0, 0];
  let refreshCalls = 0;
  const host = createServicePluginHost({
    loadPluginRuntime: async () =>
      runtimeWithActivation(
        successfulActivation(() => {
          disposalCounts[0] += 1;
        }),
      ),
    refreshPluginRuntime: () => {
      const generation = ++refreshCalls;
      return new Promise((resolve) =>
        refreshResolvers.push(() =>
          resolve(
            runtimeWithActivation(
              successfulActivation(() => {
                disposalCounts[generation] += 1;
              }),
            ),
          ),
        ),
      );
    },
  });

  await host.registerServiceRoutes(
    { use() {} },
    { ports: {}, enforceUserScopeParam, runBotOperation },
  );
  const first = host.refresh();
  const second = host.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 1);

  refreshResolvers.shift()();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(refreshCalls, 2);
  refreshResolvers.shift()();
  await second;

  assert.deepEqual(disposalCounts, [1, 1, 0]);
  await host.dispose();
  assert.deepEqual(disposalCounts, [1, 1, 1]);
});

test("dispose invalidates an activation in progress and cleans its candidate scope", async () => {
  let releaseActivation;
  let candidateDisposals = 0;
  const activationStarted = new Promise((resolve) => {
    releaseActivation = () =>
      resolve({
        protocolVersion: 2,
        pluginId: "demo",
        surface: "service",
        dispose() {
          candidateDisposals += 1;
        },
      });
  });
  const host = createServicePluginHost({
    loadPluginRuntime: async () => runtimeWithActivation(() => activationStarted),
  });
  const registration = host.registerServiceRoutes(
    { use() {} },
    { ports: {}, enforceUserScopeParam, runBotOperation },
  );
  await new Promise((resolve) => setImmediate(resolve));

  const disposal = host.dispose();
  releaseActivation();
  await assert.rejects(() => registration, /lost lifecycle ownership/);
  await disposal;
  assert.equal(candidateDisposals, 1);
  await assert.rejects(
    () =>
      host.registerServiceRoutes(
        { use() {} },
        { ports: {}, enforceUserScopeParam, runBotOperation },
      ),
    /disposed/,
  );
});
