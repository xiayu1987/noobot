/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  createConfigSnapshot,
  localizeBuiltinScenarios,
  mergeToolPolicyPatch,
  resolveBuiltinScenarios,
  RunConfigResolver,
  resolveToolBindings,
  validateConfigSnapshot,
  normalizeKnownConfigKeys,
} from "../src/index.js";
test("config snapshot is versioned and validated", () => {
  const snapshot = createConfigSnapshot({ config: { x: 1 } });
  assert.equal(snapshot.protocol, "noobot.agent-config");
  assert.equal(validateConfigSnapshot(snapshot), snapshot);
});
test("config snapshot owns immutable metadata arrays", () => {
  const metadata = { migrations: ["v0"], warnings: ["legacy"], source: "test" };
  const snapshot = createConfigSnapshot({ metadata });

  assert.notEqual(snapshot.metadata.migrations, metadata.migrations);
  assert.notEqual(snapshot.metadata.warnings, metadata.warnings);
  assert.equal(Object.isFrozen(snapshot.metadata), true);
  assert.equal(Object.isFrozen(snapshot.metadata.migrations), true);
  assert.equal(Object.isFrozen(snapshot.metadata.warnings), true);
  assert.throws(() => snapshot.metadata.migrations.push("v1"), TypeError);
  metadata.migrations.push("caller-mutation");
  assert.deepEqual(snapshot.metadata.migrations, ["v0"]);
});

test("config snapshot rejects protocol and version drift", () => {
  assert.throws(
    () => validateConfigSnapshot({ protocol: "other", version: 1 }),
    /invalid agent config protocol/,
  );
  assert.throws(
    () => validateConfigSnapshot({ protocol: "noobot.agent-config", version: 2 }),
    /unsupported agent config protocol version/,
  );
});
test("tool policy is monotonic and deny wins", () => {
  const policy = mergeToolPolicyPatch({
    baseToolPolicy: { allowToolNames: ["read_file", "execute_script"] },
    toolPolicyPatch: { denyToolNames: ["execute_script"] },
  });
  assert.deepEqual(policy.allowToolNames, ["read_file"]);
  assert.deepEqual(policy.denyToolNames, ["execute_script"]);
});
test("built-in scenarios are resolved by protocol", () => {
  assert.equal(resolveBuiltinScenarios({}, {}).default, "full");
});
test("scenario localization requires an explicit adapter", () => {
  assert.throws(() => localizeBuiltinScenarios(resolveBuiltinScenarios()), /explicit translate/);
  const localized = localizeBuiltinScenarios(resolveBuiltinScenarios(), {
    locale: "en-US",
    translate: (key, locale, fallback) => `${locale}:${key}:${fallback}`,
  });
  assert.match(localized.definitions.programming.name, /^en-US:scenarios\.programming\.name:/);
});
test("programming required tools use the scenario protocol list and deny remains final", () => {
  const sourceTools = [
    "read_file",
    "write_file",
    "search",
    "patch_file",
    "execute_script",
    "execute_native_script",
    "multimodal_generate",
    "multimodal_parse",
    "other",
  ].map((name) => ({ name }));
  const tools = resolveToolBindings({
    sourceTools,
    runConfig: {
      scenario: "programming",
      toolPolicy: { allowToolNames: ["other"], denyToolNames: ["execute_script"] },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    [
      "read_file",
      "write_file",
      "search",
      "patch_file",
      "execute_native_script",
      "multimodal_generate",
      "multimodal_parse",
      "other",
    ],
  );
});
test("custom_only is not widened by programming scenario requirements", () => {
  const tools = resolveToolBindings({
    sourceTools: [{ name: "read_file" }],
    runConfig: {
      scenario: "programming",
      toolPolicy: {
        mode: "custom_only",
        customTools: [{ name: "custom" }],
        allowToolNames: ["custom"],
      },
    },
  });
  assert.deepEqual(
    tools.map(({ name }) => name),
    ["custom"],
  );
});

test("run config resolver uses the canonical default scenario and intersects explicit policy", () => {
  const resolver = new RunConfigResolver({
    globalConfig: {
      scenarios: {
        default: "programming",
      },
    },
  });
  const resolved = resolver.resolveScenarioRunConfig(
    {
      toolPolicy: { allowToolNames: ["write_file", "other"] },
      contextPolicy: { includeContextKeys: ["base_prompt", "services"] },
    },
    {},
  );

  assert.equal(resolved.scenario, "programming");
  assert.ok(resolved.scenarioProfile.tools.includes("read_file"));
  assert.deepEqual(resolved.toolPolicy.allowToolNames, ["write_file"]);
  assert.equal(resolved.toolPolicy.forceIncludeUserInteraction, false);
  assert.deepEqual(resolved.contextPolicy.includeContextKeys, ["base_prompt", "services"]);
});

test("tool binding adds user interaction once and keeps deny authoritative", () => {
  const tools = resolveToolBindings({
    sourceTools: [
      { name: "read_file" },
      { name: "user_interaction" },
      { name: "user_interaction" },
      { name: "write_file" },
    ],
    runConfig: {
      toolPolicy: {
        allowToolNames: ["read_file", "user_interaction", "write_file"],
        denyToolNames: ["user_interaction"],
      },
    },
  });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["read_file", "write_file"],
  );
});
