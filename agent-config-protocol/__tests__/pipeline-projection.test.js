/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyConfigMigrations,
  createConfigBuildResult,
  createPluginConfigPlan,
  selectModelAlias,
  validateEffectiveConfig,
} from "../src/index.js";

test("build, migration, and validation pipeline exposes one result contract", async () => {
  const input = { nested: { value: 1 } };
  const migrationResult = await applyConfigMigrations({
    config: input,
    migrations: [
      {
        name: "increment",
        migrate: ({ config }) => ({ nested: { value: config.nested.value + 1 } }),
      },
    ],
  });
  assert.deepEqual(input, { nested: { value: 1 } });
  assert.deepEqual(migrationResult, {
    config: { nested: { value: 2 } },
    appliedMigrations: ["increment"],
  });
  assert.deepEqual(
    await validateEffectiveConfig({
      resolvedConfig: migrationResult.config,
      validators: [() => ({ warnings: ["reviewed"] })],
    }),
    ["reviewed"],
  );
  assert.deepEqual(
    createConfigBuildResult({
      rawConfig: input,
      resolvedConfig: migrationResult.config,
      metadata: { migrations: ["increment"], warnings: ["reviewed"] },
    }).metadata,
    { migrations: ["increment"], warnings: ["reviewed"] },
  );
  assert.throws(
    () => createConfigBuildResult({ rawConfig: { configParams: {} }, resolvedConfig: {} }),
    /resolution context/,
  );
});

test("plugin plan and model selection are deterministic protocol projections", () => {
  const plan = createPluginConfigPlan({
    runConfig: {
      selectedPlugins: ["workflow", "harness"],
      disabledPlugins: ["workflow"],
      plugins: { harness: { trace: false } },
    },
    effectiveConfig: { plugins: { harness: { enabled: true, timeoutMs: 1000 } } },
    manifests: [
      { pluginId: "workflow", defaults: { enabled: true } },
      { pluginId: "harness", defaults: { trace: true } },
    ],
  });
  assert.deepEqual(plan.enabledPluginIds, ["harness"]);
  assert.deepEqual(plan.plugins, [
    { pluginId: "harness", options: { trace: false, enabled: true, timeoutMs: 1000 } },
  ]);
  assert.deepEqual(
    selectModelAlias({
      selectedModel: "",
      scenario: "programming",
      effectiveConfig: {
        defaultProvider: "default",
        scenarios: { definitions: { programming: { model: "coder" } } },
      },
    }),
    { alias: "coder", source: "scenario" },
  );
});
