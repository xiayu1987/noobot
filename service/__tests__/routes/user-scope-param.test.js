/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { SUPER_ADMIN_ROLE } from "#agent/utils";
import { createAuthService } from "../../services/auth-service.js";
import { createServicePluginHost } from "../../services/service-plugin-host.js";

function pluginEntry() {
  const manifest = {
    protocolVersion: 2,
    id: "demo",
    name: "demo",
    version: "1.0.0",
    entries: { service: "service.mjs" },
    contributes: {
      service: {
        hooks: { registers: [], emits: [] },
        routes: [
          {
            id: "demo.item",
            method: "GET",
            paths: ["/plugin/:userId/item"],
            auth: "connected_user",
          },
        ],
      },
    },
    requires: {
      ports: ["hooks.register", "routes.bind"],
      permissions: [],
      authenticatedRoutes: [],
    },
    enabledByDefault: true,
  };
  return {
    pluginId: "demo",
    manifest,
    surface: "service",
    activate(host) {
      host.routes.bind("demo.item", (_req, res) => res.json({ ok: true }));
      return { protocolVersion: 2, pluginId: "demo", surface: "service", dispose() {} };
    },
  };
}

async function withScopedApp(run) {
  const authService = createAuthService({ translateText: (key) => key });
  const { requireApiKey, enforceUserScopeParam, issueApiKey } = authService;
  const app = express();
  app.use(requireApiKey);
  app.param("userId", enforceUserScopeParam);
  app.get("/main/:userId", (_req, res) => res.json({ ok: true }));
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", pluginEntry()]]), errors: [] }),
  });
  await host.registerServiceRoutes(app, {
    ports: {},
    translateText: (key) => key,
    enforceUserScopeParam,
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, apiKey) =>
    (await fetch(baseUrl + path, { headers: { "x-api-key": apiKey } })).status;
  try {
    await run({ request, issueApiKey });
  } finally {
    await host.dispose();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("user scope: app routes and plugin routes forbid another user's :userId", () =>
  withScopedApp(async ({ request, issueApiKey }) => {
    const userKey = issueApiKey({ userId: "u1", role: "user" });
    assert.equal(await request("/main/u1", userKey), 200);
    assert.equal(await request("/main/u2", userKey), 403);
    assert.equal(await request("/plugin/u1/item", userKey), 200);
    assert.equal(await request("/plugin/u2/item", userKey), 403);
  }));

test("user scope: super admin may access any :userId", () =>
  withScopedApp(async ({ request, issueApiKey }) => {
    const adminKey = issueApiKey({ userId: "admin", role: SUPER_ADMIN_ROLE });
    assert.equal(await request("/main/u2", adminKey), 200);
    assert.equal(await request("/plugin/u2/item", adminKey), 200);
  }));

test("user scope: unauthenticated request to a :userId route is rejected before the guard", () =>
  withScopedApp(async ({ request }) => {
    assert.equal(await request("/main/u1", "invalid-key"), 401);
    assert.equal(await request("/plugin/u1/item", "invalid-key"), 401);
  }));

test("service plugin host requires the user scope guard", async () => {
  const host = createServicePluginHost({
    loadPluginRuntime: async () => ({ registry: new Map([["demo", pluginEntry()]]), errors: [] }),
  });
  await assert.rejects(
    () => host.registerServiceRoutes({ use() {} }, { ports: {} }),
    /enforceUserScopeParam/,
  );
});
