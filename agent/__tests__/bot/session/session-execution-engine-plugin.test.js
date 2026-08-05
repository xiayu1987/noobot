/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionEngine } from "../../../src/bot/session/session-execution-engine.js";
import {
  AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS,
  AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS,
} from "../../../src/bot/session/run-config-plugin-preparer.js";

function createWorkspaceService(basePath) {
  return { getWorkspacePath: () => basePath };
}

test("SessionExecutionEngine activates harness by Manifest id", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-plugin-"));
  const engine = new SessionExecutionEngine({
    workspaceService: createWorkspaceService(basePath),
  });

  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    userId: "u1",
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: {
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS + 10,
          timeoutMs: 1,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.enabled, true);
  assert.equal(prepared.plugins.harness.mode, "on");
  assert.equal(prepared.plugins.harness.basePath, basePath);
  assert.equal(prepared.plugins.harness.miniRunnerMaxTurns, AGENT_PLUGIN_MINI_RUNNER_MAX_TURNS);
  assert.equal(prepared.plugins.harness.timeoutMs, AGENT_PLUGIN_SEPARATE_MODEL_MIN_TIMEOUT_MS);
  assert.equal(typeof prepared.plugins.harness.capabilityModelInvoker, "function");
  assert.equal(typeof prepared.hookManager.emit, "function");
  assert.equal(Object.hasOwn(prepared.hookManager, "runtime"), false);
});

test("SessionExecutionEngine preserves an explicit harness model invoker", () => {
  const capabilityModelInvoker = async () => ({ output: "ok" });
  const engine = new SessionExecutionEngine({});
  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    runConfig: {
      selectedPlugins: ["harness"],
      plugins: {
        harness: {
          planningGuidanceMode: "separate_model",
          capabilityModelInvoker,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.capabilityModelInvoker, capabilityModelInvoker);
});

test("plugin policy declarations merge through the single policy.patch port", () => {
  const engine = new SessionExecutionEngine({});
  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    runConfig: {
      selectedPlugins: ["harness", "workflow"],
      toolPolicy: { denyToolNames: ["base_tool"] },
      plugins: {
        harness: { denyToolNames: ["harness_tool"] },
        workflow: { denyToolNames: ["workflow_tool"] },
      },
    },
  });

  assert.deepEqual(prepared.toolPolicy.denyToolNames, [
    "base_tool",
    "harness_tool",
    "workflow_tool",
  ]);
});

test("plugin model config is keyed only by Manifest id", () => {
  const engine = new SessionExecutionEngine({});
  const prepared = engine.runConfigPluginPreparer.prepareRunConfig({
    runConfig: {
      selectedPlugins: ["harness", "workflow"],
      pluginModelConfig: {
        harness: { stepModels: { planning: "planner-model" } },
        workflow: { semanticModel: "workflow-model" },
      },
    },
  });

  assert.equal(prepared.plugins.harness.stepModels.planning, "planner-model");
  assert.equal(prepared.plugins.workflow.semanticModel, "workflow-model");
});
