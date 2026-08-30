/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createPluginActivationResult,
  createPluginContributionIdentity,
  createPluginLifecycleRecord,
  parsePluginManifest,
  PLUGIN_LIFECYCLE_EVENT,
  PLUGIN_PROTOCOL_VERSION,
  requireDeclaredFrontendContribution,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
  validatePluginContributionReceipt,
} from "../src/index.js";

const manifest = {
  protocolVersion: PLUGIN_PROTOCOL_VERSION,
  id: "example",
  name: "example-plugin",
  version: "1.0.0",
  entries: { agent: "src/agent.js", frontend: "frontend/index.js" },
  contributes: {
    agent: {
      hooks: {
        registers: [{ id: "before-turn", point: "agent.before_turn" }],
        emits: ["workflow.node_agent_execute"],
      },
    },
    frontend: { extensions: [{ id: "example-card", point: "message.card.pre" }] },
  },
  requires: {
    ports: ["hooks.register", "hooks.emit", "frontend.contribute"],
    permissions: [],
    authenticatedRoutes: [],
  },
  enabledByDefault: true,
};

test("manifest V2 is strict and surface-owned", () => {
  const parsed = parsePluginManifest(manifest);
  assert.equal(parsed.id, "example");
  assert.deepEqual(requireDeclaredPluginHook(parsed, "agent", "agent.before_turn", "before-turn"), {
    id: "before-turn",
    point: "agent.before_turn",
  });
  assert.equal(
    requireDeclaredPluginHookEmission(parsed, "agent", "workflow.node_agent_execute"),
    "workflow.node_agent_execute",
  );
  assert.equal(
    requireDeclaredFrontendContribution(parsed, "example-card", "message.card.pre").id,
    "example-card",
  );
  assert.throws(() => parsePluginManifest({ ...manifest, pluginKey: "legacy" }), /unrecognized/i);
  assert.throws(() => parsePluginManifest({ ...manifest, protocolVersion: 1 }), /protocolVersion/i);
  assert.throws(
    () =>
      parsePluginManifest({
        ...manifest,
        requires: { ...manifest.requires, ports: ["hooks.register", "frontend.contribute"] },
      }),
    /hooks\.emit/,
  );
});

test("contribution receipts must exactly match structured declarations", () => {
  assert.deepEqual(
    validatePluginContributionReceipt(manifest, "agent", [
      { type: "hook", registrationId: "before-turn", point: "agent.before_turn" },
    ]),
    ["hook:before-turn:agent.before_turn"],
  );
  assert.throws(
    () =>
      validatePluginContributionReceipt(manifest, "agent", [
        { type: "hook", registrationId: "before-turn", point: "agent.after_turn" },
      ]),
    /missing: hook:before-turn:agent\.before_turn.*unexpected: hook:before-turn:agent\.after_turn/,
  );
  assert.throws(
    () =>
      validatePluginContributionReceipt(manifest, "agent", [
        { type: "hook", registrationId: "before-turn", point: "agent.before_turn" },
        { type: "hook", registrationId: "before-turn", point: "agent.before_turn" },
      ]),
    /duplicate contributions/,
  );
});

test("activation result has one protocol shape", () => {
  const result = createPluginActivationResult({ pluginId: "example", surface: "agent" });
  assert.equal(result.protocolVersion, PLUGIN_PROTOCOL_VERSION);
  assert.equal(result.pluginId, "example");
  assert.equal(result.surface, "agent");
  assert.equal(result.status, "activated");
});

test("protected host ports require their protocol permissions", () => {
  assert.throws(
    () =>
      parsePluginManifest({
        ...manifest,
        requires: {
          ...manifest.requires,
          ports: [...manifest.requires.ports, "model.invoke"],
        },
      }),
    /model\.invoke is required by port model\.invoke/,
  );
});

test("authenticated browser routes declare their exact HTTP method", () => {
  const parsed = parsePluginManifest({
    ...manifest,
    entries: { ...manifest.entries, service: "src/service.js" },
    requires: {
      ports: [...manifest.requires.ports, "authenticated_request"],
      permissions: ["http.authenticated"],
      authenticatedRoutes: [{ method: "PUT", path: "/api/internal/example/:id" }],
    },
  });
  assert.deepEqual(parsed.requires.authenticatedRoutes, [
    { method: "PUT", path: "/api/internal/example/:id" },
  ]);
  assert.throws(
    () =>
      parsePluginManifest({
        ...manifest,
        requires: {
          ...manifest.requires,
          authenticatedRoutes: ["/api/internal/example/:id"],
        },
      }),
    /expected object/i,
  );
});

test("every required host port is available on a declared entry surface", () => {
  assert.throws(
    () =>
      parsePluginManifest({
        ...manifest,
        requires: {
          ...manifest.requires,
          ports: [...manifest.requires.ports, "routes.bind"],
        },
      }),
    /routes\.bind is not available on any declared plugin entry/,
  );
});

test("plugin lifecycle and contribution identities have one protocol shape", () => {
  const identity = createPluginContributionIdentity({
    pluginId: "example",
    surface: "frontend",
    localId: "card",
  });
  assert.deepEqual(identity, { pluginId: "example", surface: "frontend", localId: "card" });
  const record = createPluginLifecycleRecord({
    event: PLUGIN_LIFECYCLE_EVENT.ACTIVATED,
    entry: { pluginId: "example", surface: "frontend", manifest },
  });
  assert.equal(record.event, "plugin.activated");
  assert.equal(record.pluginId, "example");
  assert.throws(
    () =>
      createPluginLifecycleRecord({
        event: "plugin.unknown",
        entry: { pluginId: "example", surface: "frontend", manifest },
      }),
    /unsupported plugin lifecycle event/,
  );
});
