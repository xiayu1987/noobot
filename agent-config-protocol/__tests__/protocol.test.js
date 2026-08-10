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
  resolveToolBindings,
  validateConfigSnapshot,
} from "../src/index.js";
test("config snapshot is versioned and validated", () => {
  const snapshot = createConfigSnapshot({ config: { x: 1 } });
  assert.equal(snapshot.protocol, "noobot.agent-config");
  assert.equal(validateConfigSnapshot(snapshot), snapshot);
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
    "process_content_task",
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
    ["read_file", "write_file", "search", "patch_file", "process_content_task", "other"],
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
