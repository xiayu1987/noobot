/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeConfig } from "../../src/config/index.js";

import { resolveEffectiveModelSpec } from "../../src/runtime/run-config/config-resolver.js";
import { initializeAgentModelHost } from "../../src/runtime/model-port-host.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";

const globalConfig = {
  providers: {
    scenario_default: {
      enabled: true,
      used_for_conversation: true,
      model: "scenario-default-model",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
      api_key: "test-key",
      base_url: "http://localhost/scenario",
    },
    selected_alias: {
      enabled: true,
      used_for_conversation: true,
      model: "selected-model",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
      api_key: "test-key",
      base_url: "http://localhost/selected",
    },
  },
  scenarios: {
    definitions: {
      programming: {
        model: "scenario_default",
      },
    },
  },
  defaultProvider: "scenario_default",
};

test("resolveEffectiveModelSpec uses selectedModel string before scenario default", () => {
  const spec = resolveEffectiveModelSpec({
    effectiveConfig: mergeConfig(globalConfig, {}),
    selectedModel: "selected_alias",
    scenario: "programming",
  });

  assert.equal(spec.alias, "selected_alias");
  assert.equal(spec.model, "selected-model");
});

test("resolveEffectiveModelSpec rejects an invalid explicit selection even when defaults exist", () => {
  assert.throws(
    () =>
      resolveEffectiveModelSpec({
        effectiveConfig: mergeConfig(globalConfig, {}),
        selectedModel: "missing_alias",
        scenario: "programming",
      }),
    { code: "MODEL_REFERENCE_NOT_FOUND" },
  );
});

test("resolveEffectiveModelSpec uses scenario model as initial model fallback", () => {
  const spec = resolveEffectiveModelSpec({
    effectiveConfig: mergeConfig(
      {
        providers: {
          scenario_model_alias: {
            enabled: true,
            used_for_conversation: true,
            model: "scenario-model",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            api_key: "test-key",
            base_url: "http://localhost/scenario-model",
          },
          system_default: {
            enabled: true,
            used_for_conversation: true,
            model: "system-default-model",
            reasoning_effort_parameter: "reasoning_effort",
            reasoning_effort_options: ["none", "low", "medium", "high"],
            api_key: "test-key",
            base_url: "http://localhost/system",
          },
        },
        scenarios: {
          definitions: {
            programming: {
              model: "scenario_model_alias",
            },
          },
        },
        defaultProvider: "system_default",
      },
      {},
    ),
    selectedModel: "",
    scenario: "programming",
  });

  assert.equal(spec.alias, "scenario_model_alias");
  assert.equal(spec.model, "scenario-model");
});

test("model capability failure blocks only that selection and recovers after correction", () => {
  const config = structuredClone(globalConfig);
  config.providers.selected_alias.used_for_conversation = false;
  assert.throws(
    () =>
      resolveEffectiveModelSpec({
        effectiveConfig: mergeConfig(config, {}),
        selectedModel: "selected_alias",
      }),
    { code: "MODEL_REFERENCE_CAPABILITY_MISMATCH" },
  );
  assert.equal(
    resolveEffectiveModelSpec({ effectiveConfig: mergeConfig(config, {}) }).alias,
    "scenario_default",
  );
  config.providers.selected_alias.used_for_conversation = true;
  assert.equal(
    resolveEffectiveModelSpec({
      effectiveConfig: mergeConfig(config, {}),
      selectedModel: "selected_alias",
    }).alias,
    "selected_alias",
  );
});

test("effective model resolution honors user overrides without changing configuration", () => {
  const effectiveConfig = mergeConfig(globalConfig, {
    providers: { selected_alias: { model: "user-model" } },
    defaultProvider: "selected_alias",
  });
  const before = structuredClone(effectiveConfig);
  assert.equal(resolveEffectiveModelSpec({ effectiveConfig }).model, "user-model");
  assert.equal(
    resolveEffectiveModelSpec({ effectiveConfig, scenario: "programming" }).alias,
    "scenario_default",
  );
  assert.deepEqual(effectiveConfig, before);
});

test("disabled and missing providers preserve selection error paths without fallback", () => {
  const effectiveConfig = mergeConfig(globalConfig, {
    providers: { selected_alias: { enabled: false } },
  });
  const selections = [
    { selectedModel: "selected_alias", path: "selectedModel" },
    { selectedModel: "toString", path: "selectedModel" },
    { scenario: "programming", path: "scenarios.definitions.programming.model" },
    { path: "default_provider" },
  ];
  effectiveConfig.providers.scenario_default.enabled = false;
  for (const { path, ...selection } of selections) {
    assert.throws(
      () => resolveEffectiveModelSpec({ effectiveConfig, ...selection }),
      (error) => {
        assert.equal(error.code, "MODEL_REFERENCE_NOT_FOUND");
        assert.equal(error.details.path, path);
        assert.equal(error.details.requirement, "conversation");
        return true;
      },
    );
  }
});

function initializeHostWithRunConfig(runConfig) {
  const runtime = createTestRuntimeContext({
    globalConfig,
    userConfig: {},
    runConfig: { hookManager: null, ...runConfig },
  });
  return initializeAgentModelHost({
    runtime,
    invocationIdentity: {
      sessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "dialog-model-selection",
      turnScopeId: "turn-model-selection",
      runId: "r-1",
    },
  });
}

test("model host resolves the canonical runConfig selectedModel before the scenario model", () => {
  const host = initializeHostWithRunConfig({
    selectedModel: "selected_alias",
    scenario: "programming",
  });

  assert.equal(host.modelSpec.alias, "selected_alias");
  assert.equal(host.modelState.activeModelSpec, host.modelSpec);
  assert.equal(host.modelState.defaultModelSpec, host.modelSpec);
});

test("model host resolves the canonical runConfig scenario model without selectedModel", () => {
  const host = initializeHostWithRunConfig({ selectedModel: "", scenario: "programming" });

  assert.equal(host.modelSpec.alias, "scenario_default");
});
