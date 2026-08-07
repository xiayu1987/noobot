/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RunConfigPluginPreparer } from "../../src/bot/session/run-config-plugin-preparer.js";

function entry({ id, hooks = [], emits = [], executionIntent, activate } = {}) {
  return {
    pluginId: id,
    surface: "agent",
    manifest: {
      protocolVersion: 2,
      id,
      name: id,
      version: "1.0.0",
      entries: { agent: "agent.js" },
      contributes: { agent: {
        hooks: { registers: hooks, emits },
        ...(executionIntent ? { executionIntent } : {}),
      } },
      requires: { ports: ["hooks.register"], permissions: [], authenticatedRoutes: [] },
      enabledByDefault: true,
    },
    activate,
  };
}

function activation(id, hostAction = () => {}) {
  return (host, config) => {
    hostAction(host, config);
    return { protocolVersion: 2, pluginId: id, surface: "agent", dispose() {} };
  };
}

function preparer(entries) {
  return new RunConfigPluginPreparer({
    loadedDynamicPlugins: { registry: new Map(entries.map((item) => [item.pluginId, item])) },
    normalizeStringArray: (input) => Array.isArray(input) ? input : [],
    createPluginResolveModelMessages: () => () => [],
  });
}

test("pluginPolicy none disables plugin selection for tool sub-sessions", () => {
  const demo = entry({ id: "demo", activate: activation("demo") });
  const prepared = preparer([demo]).prepareRunConfig({
    runConfig: {
      selectedPlugins: ["demo"],
      pluginPolicy: { mode: "none" },
    },
  });
  assert.deepEqual(prepared.selectedPlugins, []);
  assert.equal(prepared.hookManager, undefined);
  assert.equal(prepared.botHookManager, undefined);
});

test("activates selected Manifest ids and scopes declared hook registrations", () => {
  const demo = entry({
    id: "demo",
    hooks: ["agent.before_turn"],
    activate: activation("demo", (host) => {
      host.hooks.register("agent.before_turn", () => {}, { id: "before", priority: 10 });
      host.policy.patch({ denyToolNames: ["unsafe_tool"] });
    }),
  });
  const prepared = preparer([demo]).prepareRunConfig({
    runConfig: { selectedPlugins: ["demo"], plugins: { demo: { trace: false } } },
  });

  assert.equal(prepared.plugins.demo.enabled, true);
  assert.equal(prepared.plugins.demo.mode, "on");
  assert.deepEqual(prepared.toolPolicy.denyToolNames, ["unsafe_tool"]);
  assert.equal(prepared.hookManager.list("agent.before_turn")[0].id, "demo:before");
  assert.equal("agentPlugin" in prepared.plugins, false);
  assert.equal("botPlugin" in prepared.plugins, false);
});

test("rejects registration of an undeclared hook", () => {
  const demo = entry({
    id: "demo",
    activate: activation("demo", (host) => host.hooks.register("agent.before_turn", () => {}, { id: "hidden" })),
  });
  assert.throws(
    () => preparer([demo]).prepareRunConfig({ runConfig: { selectedPlugins: ["demo"] } }),
    /did not declare hook/,
  );
});

test("routes declared bot hooks and workflow emissions through the orchestration manager", async () => {
  const demo = entry({
    id: "demo",
    hooks: ["bot.before_agent_dispatch"],
    emits: ["workflow.node_agent_execute"],
    activate: activation("demo", (host) => {
      host.hooks.register("bot.before_agent_dispatch", () => {}, { id: "dispatch" });
      void host.hooks.emit("workflow.node_agent_execute", {});
    }),
  });
  const prepared = preparer([demo]).prepareRunConfig({ runConfig: { selectedPlugins: ["demo"] } });
  assert.equal(prepared.botHookManager.list("bot.before_agent_dispatch")[0].id, "demo:dispatch");
  assert.equal(prepared.hookManager.list("bot.before_agent_dispatch").length, 0);
});

test("derives the single selected execution intent from Manifest", () => {
  const workflow = entry({
    id: "workflow",
    hooks: ["bot.before_agent_dispatch"],
    executionIntent: {
      kind: "workflow",
      idPrefix: "workflow",
      originType: "workflow",
      originIdKey: "workflowRunId",
      stage: "planning",
    },
    activate: activation("workflow"),
  });
  const intent = preparer([workflow]).resolveExecutionIntent({
    runConfig: { selectedPlugins: ["workflow"], turnScopeId: "turn-1" },
  });
  assert.equal(intent.executionId, "workflow:turn-1");
  assert.equal(intent.executionKind, "workflow");
  assert.deepEqual(intent.origin, { type: "workflow", workflowRunId: "workflow:turn-1" });
});
