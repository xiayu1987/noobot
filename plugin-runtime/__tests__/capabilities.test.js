/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  manifestSupportsCapability,
  normalizePluginCapabilities,
  PLUGIN_CAPABILITIES,
  PLUGIN_CAPABILITY,
  resolveCapabilityRuntimeSurface,
  resolveManifestRuntimeOptionsByCapability,
  resolvePluginExecutionIntentDeclaration,
  validateManifestCapabilityEntries,
} from "../src/index.js";

test("capability registry exposes stable host capabilities", () => {
  assert.equal(PLUGIN_CAPABILITY.AGENT_REGISTER, "agent.register");
  assert.equal(PLUGIN_CAPABILITY.AGENT_EXECUTION_INTENT, "agent.execution_intent");
  assert.equal(PLUGIN_CAPABILITY.BOT_REGISTER, "bot.register");
  assert.equal(PLUGIN_CAPABILITY.SERVICE_HTTP_ROUTES, "service.http_routes");
  assert.equal(PLUGIN_CAPABILITY.SERVICE_AFTER_SESSION_DELETE, "service.after_session_delete");
  assert.equal(PLUGIN_CAPABILITY.FRONTEND_RUNTIME_PROJECTION, "frontend.runtime_projection");
  assert.deepEqual(PLUGIN_CAPABILITIES, Object.values(PLUGIN_CAPABILITY));
});

test("execution intent is resolved from the selected plugin declaration", () => {
  const loadedPlugins = {
    registry: new Map([["workflow", {
      pluginId: "workflow",
      manifest: {
        id: "workflow",
        pluginKey: "workflow",
        capabilities: ["agent.execution_intent"],
        runtimeOptions: {
          "agent.execution_intent": {
            executionKind: "workflow",
            executionIdPrefix: "workflow",
            originType: "workflow",
            originIdKey: "workflowRunId",
            stage: "planning",
          },
        },
      },
    }]]),
  };
  assert.deepEqual(resolvePluginExecutionIntentDeclaration(loadedPlugins, "workflow"), {
    executionKind: "workflow",
    executionIdPrefix: "workflow",
    originType: "workflow",
    originIdKey: "workflowRunId",
    stage: "planning",
    pluginKey: "workflow",
  });
  assert.equal(resolvePluginExecutionIntentDeclaration(loadedPlugins, "missing"), null);
});

test("capabilities are normalized and de-duplicated", () => {
  assert.deepEqual(
    normalizePluginCapabilities([" agent.register ", "", "agent.register", "service.http_routes"]),
    ["agent.register", "service.http_routes"],
  );
});

test("manifest capability supports declarations and legacy runtime options", () => {
  assert.equal(
    manifestSupportsCapability({ capabilities: ["service.http_routes"] }, "service.http_routes"),
    true,
  );
  assert.equal(
    manifestSupportsCapability(
      { runtimeOptions: { "service.http_routes": { enabled: true } } },
      "service.http_routes",
    ),
    true,
  );
  assert.equal(manifestSupportsCapability({}, "service.http_routes"), false);
});

test("runtime options are returned as a defensive copy", () => {
  const source = { priority: 10 };
  const resolved = resolveManifestRuntimeOptionsByCapability(
    { runtimeOptions: { "service.http_routes": source } },
    "service.http_routes",
  );
  assert.deepEqual(resolved, source);
  assert.notEqual(resolved, source);
  assert.deepEqual(resolveManifestRuntimeOptionsByCapability({}, "service.http_routes"), {});
});

test("capabilities map to host runtime surfaces", () => {
  assert.equal(resolveCapabilityRuntimeSurface("agent.register"), "agent");
  assert.equal(resolveCapabilityRuntimeSurface("agent.custom"), "agent");
  assert.equal(resolveCapabilityRuntimeSurface("bot.register"), "agent");
  assert.equal(resolveCapabilityRuntimeSurface("service.http_routes"), "service");
  assert.equal(resolveCapabilityRuntimeSurface("frontend.extension"), "frontend");
  assert.equal(resolveCapabilityRuntimeSurface("test.demo"), "");
});

test("manifest only requires entries for declared host capabilities", () => {
  assert.deepEqual(validateManifestCapabilityEntries({
    capabilities: ["agent.register"],
    entries: { agent: "src/agent.js" },
  }), []);
  assert.deepEqual(validateManifestCapabilityEntries({
    capabilities: ["agent.register", "service.http_routes"],
    entries: { agent: "src/agent.js" },
  }), [{
    capability: "service.http_routes",
    runtimeSurface: "service",
    reason: "missing_service_entry",
  }]);
});
