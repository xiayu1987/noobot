/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveModelSpec } from "../../src/runtime/run-config/config-resolver.js";
import { initializeAgentModelHost } from "../../src/runtime/model-port-host.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";

const globalConfig = {
  providers: {
    scenario_default: {
      enabled: true,
      model: "scenario-default-model",
      reasoning_effort_parameter: "reasoning_effort",
      reasoning_effort_options: ["none", "low", "medium", "high"],
      api_key: "test-key",
      base_url: "http://localhost/scenario",
    },
    selected_alias: {
      enabled: true,
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
    globalConfig,
    userConfig: {},
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
        globalConfig,
        userConfig: {},
        selectedModel: "missing_alias",
        scenario: "programming",
      }),
    /selected model not found: missing_alias/,
  );
});

test("resolveEffectiveModelSpec uses scenario model as initial model fallback", () => {
  const spec = resolveEffectiveModelSpec({
    globalConfig: {
      providers: {
        scenario_model_alias: {
          enabled: true,
          model: "scenario-model",
          reasoning_effort_parameter: "reasoning_effort",
          reasoning_effort_options: ["none", "low", "medium", "high"],
          api_key: "test-key",
          base_url: "http://localhost/scenario-model",
        },
        system_default: {
          enabled: true,
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
    userConfig: {},
    selectedModel: "",
    scenario: "programming",
  });

  assert.equal(spec.alias, "scenario_model_alias");
  assert.equal(spec.model, "scenario-model");
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
