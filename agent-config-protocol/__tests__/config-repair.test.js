/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONFIG_DOCUMENT_SCOPE,
  CONFIG_NODE_POLICY,
  CONFIG_PATH_REPRESENTATION,
  CONFIG_REPAIR_ACTION,
  listConfigNodePathsByPolicy,
  mergeConfig,
  normalizeKnownConfigKeys,
  repairConfigDocument,
  sanitizeUserConfig,
} from "../src/index.js";

function readJsonFixture(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function collectObjectOnlyPaths(source, reference, prefix = "") {
  const paths = [];
  for (const key of Object.keys(source || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(reference || {}, key)) {
      paths.push(path);
      continue;
    }
    const sourceValue = source[key];
    const referenceValue = reference[key];
    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      referenceValue &&
      typeof referenceValue === "object" &&
      !Array.isArray(referenceValue)
    )
      paths.push(...collectObjectOnlyPaths(sourceValue, referenceValue, path));
  }
  return paths;
}

test("default user template is the user-scope source of truth for system-owned nodes", () => {
  const globalTemplate = readJsonFixture("../../service/config/global.config.example.json");
  const userTemplate = readJsonFixture("../../user-template/default-user/config.example.json");
  const globalOnlyPaths = collectObjectOnlyPaths(globalTemplate, userTemplate).sort();
  const systemOwnedPaths = [
    ...listConfigNodePathsByPolicy({
      policy: CONFIG_NODE_POLICY.GLOBAL_ONLY,
      representation: CONFIG_PATH_REPRESENTATION.PERSISTED,
    }),
  ].sort();
  const systemOwnedRuntimePaths = [
    ...listConfigNodePathsByPolicy({
      policy: CONFIG_NODE_POLICY.GLOBAL_ONLY,
      representation: CONFIG_PATH_REPRESENTATION.RUNTIME,
    }),
  ].sort();
  for (const path of globalOnlyPaths)
    assert.ok(
      systemOwnedPaths.some((ownedPath) => ownedPath === path || ownedPath.startsWith(`${path}.`)),
    );
  const legacyUserConfig = structuredClone(globalTemplate);
  legacyUserConfig.tools.execute_native_script = { enabled: false };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.USER,
    baseValues: userTemplate,
    target: legacyUserConfig,
  });
  for (const path of systemOwnedPaths)
    assert.equal(
      path.split(".").reduce((node, key) => node?.[key], repaired.document),
      undefined,
    );
  const sanitized = sanitizeUserConfig(legacyUserConfig);
  const merged = mergeConfig(globalTemplate, legacyUserConfig);
  const normalizedGlobalTemplate = normalizeKnownConfigKeys(globalTemplate);
  for (const path of systemOwnedRuntimePaths) {
    assert.equal(
      path.split(".").reduce((node, key) => node?.[key], sanitized),
      undefined,
    );
    assert.deepEqual(
      path.split(".").reduce((node, key) => node?.[key], merged),
      path.split(".").reduce((node, key) => node?.[key], normalizedGlobalTemplate),
    );
  }
});

test("config repair recursively adds template nodes through one protocol", () => {
  const synchronized = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: {
      workspace_root: "/template",
      providers: {
        primary: {
          reasoning_effort: "medium",
          tool_reasoning_effort: "medium",
          capabilities: { web_search: true },
        },
        added: { enabled: true },
      },
      tools: {
        execute_script: { enabled: true, sandbox_mode: true },
        read_file: { enabled: true },
        delegate_task_async: { enabled: true, waitTimeoutMs: 30000 },
      },
    },
    target: {
      workspace_root: "/configured",
      providers: {
        primary: { reasoning_effort: "high" },
        custom: { model: "custom-model", format: "openai_compatible", enabled: true },
      },
      tools: { obsolete_tool: { enabled: true } },
      user_only: true,
    },
  }).document;
  assert.equal(synchronized.workspace_root, "/configured");
  assert.deepEqual(synchronized.providers.primary, {
    reasoning_effort: "high",
    tool_reasoning_effort: "medium",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort_parameter: "reasoning_effort",
    capabilities: { web_search: true },
  });
  assert.deepEqual(synchronized.providers.added, { enabled: true });
  assert.equal(synchronized.providers.custom.model, "custom-model");
  assert.equal("format" in synchronized.providers.custom, false);
  assert.deepEqual(synchronized.tools, {
    execute_script: { enabled: true },
    read_file: { enabled: true },
    delegate_task_async: { enabled: true, waitTimeoutMs: 30000 },
  });
});

test("config repair separates structural fields from default values", () => {
  // Structure is owned by the field contract; the value source only answers
  // "what value stands here", so a value-only key can never add a field.
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: { preferences: { language: "zh-CN" }, undeclared_field: "ignored" },
    target: { preferences: {} },
  });
  assert.deepEqual(repaired.document, { preferences: { language: "zh-CN" } });
  assert.equal("undeclared_field" in repaired.document, false);
});

test("config repair restores invalid values and enforces node policies", () => {
  const template = { workspace_root: "/template", workspace_template_path: "/template-default" };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: template,
    target: { workspace_root: { invalid: true }, workspace_template_path: "/custom-template" },
  });
  assert.equal(repaired.document.workspace_root, "/template");
  assert.equal(repaired.document.workspace_template_path, "/custom-template");
  assert.deepEqual(repaired.report.changes, [
    {
      path: "workspace_root",
      action: CONFIG_REPAIR_ACTION.RESET_TO_DEFAULT,
      reason: "invalid_node_type",
    },
  ]);
});
