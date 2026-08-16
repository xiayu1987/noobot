/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createPluginActivationResult,
  parsePluginManifest,
  PLUGIN_PROTOCOL_VERSION,
  requireDeclaredFrontendContribution,
  requireDeclaredPluginHook,
  requireDeclaredPluginHookEmission,
} from "../src/index.js";

const manifest = {
  protocolVersion: PLUGIN_PROTOCOL_VERSION,
  id: "example",
  name: "example-plugin",
  version: "1.0.0",
  entries: { agent: "src/agent.js", frontend: "frontend/index.js" },
  contributes: {
    agent: { hooks: { registers: ["agent.before_turn"], emits: ["workflow.node_agent_execute"] } },
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
  assert.equal(
    requireDeclaredPluginHook(parsed, "agent", "agent.before_turn"),
    "agent.before_turn",
  );
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

test("activation result has one protocol shape", () => {
  const result = createPluginActivationResult({ pluginId: "example", surface: "agent" });
  assert.equal(result.protocolVersion, PLUGIN_PROTOCOL_VERSION);
  assert.equal(result.pluginId, "example");
  assert.equal(result.surface, "agent");
  assert.equal(result.status, "activated");
});
