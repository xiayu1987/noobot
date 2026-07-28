/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mergeRunConfigWithPluginStrategy } from "../../src/bot/session/run-config-plugin-strategy.js";

test("mergeRunConfigWithPluginStrategy persists disabled plugins across run-config preparation", () => {
  const merged = mergeRunConfigWithPluginStrategy({
    baseRunConfig: {
      disabledPlugins: ["existing-plugin"],
      selectedPlugins: ["workflow", "harness"],
      plugins: {
        workflow: { enabled: true, mode: "on", semanticModel: "planner" },
        harness: { enabled: true, mode: "on" },
      },
    },
    runConfigPatch: {
      turnScopeId: "workflow-node:node-a",
    },
    disabledPlugins: ["workflow", "workflow"],
  });

  assert.deepEqual(merged.disabledPlugins, ["existing-plugin", "workflow"]);
  assert.deepEqual(merged.selectedPlugins, ["harness"]);
  assert.deepEqual(merged.plugins.workflow, {
    enabled: false,
    mode: "off",
    semanticModel: "planner",
  });
  assert.deepEqual(merged.plugins.harness, { enabled: true, mode: "on" });
  assert.equal(merged.turnScopeId, "workflow-node:node-a");
});
