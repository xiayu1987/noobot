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
  WEB_SEARCH_MODE,
} from "../src/index.js";
import {
  resolveDefaultModelLibraryProvider,
  resolveModelLibraryProvider,
} from "@noobot/model-protocol";

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

test("provider system declarations cannot be overridden by user config", () => {
  const globalConfig = {
    providers: {
      primary: {
        model: "global-model",
        reasoning_effort_options: ["none", "high"],
        reasoning_effort_parameter: "reasoning_effort",
        use_responses_api: true,
        cache_control: { type: "ephemeral" },
        capabilities: { reasoning: true, tools: true },
      },
    },
  };
  const userConfig = {
    providers: {
      primary: {
        model: "user-model",
        reasoning_effort_options: ["forged"],
        reasoning_effort_parameter: "enable_thinking",
        use_responses_api: false,
        cache_control: false,
        capabilities: { reasoning: false, tools: false },
      },
    },
  };

  assert.deepEqual(mergeConfig(globalConfig, userConfig).providers.primary, {
    model: "user-model",
    reasoning_effort_options: ["none", "high"],
    reasoning_effort_parameter: "reasoning_effort",
    use_responses_api: true,
    cache_control: { type: "ephemeral" },
    capabilities: { reasoning: true, tools: true },
  });
});

test("provider runtime authority rejects user-owned system declarations", () => {
  const customProvider = {
    enabled: true,
    used_for_conversation: true,
    model: "ZHIPU/GLM-5.3",
    reasoning_effort: "low",
    tool_reasoning_effort: "medium",
    reasoning_effort_options: ["low", "medium", "high"],
    reasoning_effort_parameter: "reasoning_effort",
    use_responses_api: true,
    capabilities: { reasoning: true, tools: true },
  };
  const userConfig = {
    providers: {
      GLM_5_3: customProvider,
      primary: {
        model: "user-model",
        reasoning_effort_options: ["forged"],
        reasoning_effort_parameter: "enable_thinking",
      },
    },
  };
  const globalConfig = {
    providers: {
      primary: {
        model: "global-model",
        reasoning_effort_options: ["none", "high"],
        reasoning_effort_parameter: "reasoning_effort",
      },
    },
  };

  assert.deepEqual(sanitizeUserConfig(userConfig).providers.GLM_5_3, {
    enabled: true,
    used_for_conversation: true,
    model: "ZHIPU/GLM-5.3",
    reasoning_effort: "low",
    tool_reasoning_effort: "medium",
  });
  const merged = mergeConfig(globalConfig, userConfig);
  const genericProvider = resolveDefaultModelLibraryProvider();
  assert.deepEqual(merged.providers.GLM_5_3, {
    ...genericProvider,
    reasoning_effort_options: [],
    enabled: true,
    used_for_conversation: true,
    model: "ZHIPU/GLM-5.3",
    reasoning_effort: "low",
    tool_reasoning_effort: "medium",
  });
  assert.equal(merged.providers.GLM_5_3.reasoning_effort, "low");
  assert.equal(merged.providers.GLM_5_3.tool_reasoning_effort, "medium");
  assert.deepEqual(merged.providers.primary, {
    model: "user-model",
    reasoning_effort_options: ["none", "high"],
    reasoning_effort_parameter: "reasoning_effort",
  });
});

test("user-only providers use an exact model-library authority before generic fallback", () => {
  const libraryProvider = resolveModelLibraryProvider("gpt_5_6_sol");
  assert.ok(libraryProvider);
  const merged = mergeConfig(
    { providers: {} },
    {
      providers: {
        gpt_5_6_sol: {
          model: "user-model",
          reasoning_effort_options: ["forged"],
          reasoning_effort_parameter: "enable_thinking",
        },
      },
    },
  );

  assert.deepEqual(merged.providers.gpt_5_6_sol, {
    ...libraryProvider,
    model: "user-model",
  });
});

test("global config delegates path-policy content without creating a second schema", () => {
  const pathPolicy = {
    roles: {
      super_admin: {
        host: { denied_roots: ["/private"] },
      },
    },
  };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: { security: { trusted_directories: ["*"] } },
    target: { security: { trusted_directories: ["/srv/project"], path_policy: pathPolicy } },
  });
  assert.deepEqual(repaired.document.security.path_policy, pathPolicy);
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
        task_summary: { enabled: true, phaseSummaryLoopTurns: 10 },
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
  assert.equal(synchronized.providers.primary.reasoning_effort, "high");
  assert.equal(synchronized.providers.primary.model, "default-model");
  assert.equal(
    synchronized.providers.primary.description,
    "Generic OpenAI-compatible fallback model",
  );
  assert.equal(synchronized.providers.primary.tool_reasoning_effort, "medium");
  assert.equal(synchronized.providers.added.enabled, true);
  assert.equal(synchronized.providers.added.model, "default-model");
  assert.equal(
    synchronized.providers.added.description,
    "Generic OpenAI-compatible fallback model",
  );
  assert.deepEqual(synchronized.providers.added.reasoning_effort_options, [
    "low",
    "medium",
    "high",
  ]);
  assert.equal(synchronized.providers.custom.model, "custom-model");
  assert.equal("format" in synchronized.providers.custom, false);
  assert.deepEqual(synchronized.tools, {
    execute_script: { enabled: true },
    read_file: { enabled: true },
    task_summary: { enabled: true, phaseSummaryLoopTurns: 10 },
  });
});

test("config repair separates structural fields from default values", () => {
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

test("config repair restores web_search mode outside the declared enum", () => {
  const template = {
    tools: { web_search: { enabled: true, mode: WEB_SEARCH_MODE.MODEL_WEB_SEARCH } },
  };
  const repaired = repairConfigDocument({
    scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
    baseValues: template,
    target: { tools: { web_search: { enabled: true, mode: "responses_api" } } },
  });
  assert.equal(repaired.document.tools.web_search.mode, WEB_SEARCH_MODE.MODEL_WEB_SEARCH);
  assert.ok(
    repaired.report.changes.some((change) => change.path === "tools.web_search.mode"),
    "expected tools.web_search.mode to be reported as repaired",
  );
});

test("config repair keeps every declared web_search mode value", () => {
  for (const mode of Object.values(WEB_SEARCH_MODE)) {
    const repaired = repairConfigDocument({
      scope: CONFIG_DOCUMENT_SCOPE.GLOBAL,
      baseValues: {
        tools: { web_search: { enabled: true, mode: WEB_SEARCH_MODE.MODEL_WEB_SEARCH } },
      },
      target: { tools: { web_search: { enabled: true, mode } } },
    });
    assert.equal(repaired.document.tools.web_search.mode, mode);
  }
});
