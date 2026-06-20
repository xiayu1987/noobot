import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveModelSpec } from "../../src/system-core/agent/core/config/config-resolver.js";
import { createStateBuilder } from "../../src/system-core/agent/core/state-builder.js";

const globalConfig = {
  providers: {
    scenario_default: {
      enabled: true,
      type: "openai_compatible",
      model: "scenario-default-model",
      apiKey: "test-key",
      baseUrl: "http://localhost/scenario",
    },
    selected_alias: {
      enabled: true,
      type: "openai_compatible",
      model: "selected-model",
      apiKey: "test-key",
      baseUrl: "http://localhost/selected",
    },
  },
  scenarios: {
    definitions: {
      programming: {
        defaultModelAlias: "scenario_default",
      },
    },
  },
  defaultModelAlias: "scenario_default",
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

test("resolveEffectiveModelSpec accepts selectedModel object before scenario default", () => {
  const spec = resolveEffectiveModelSpec({
    globalConfig,
    userConfig: {},
    selectedModel: { value: "selected_alias" },
    scenario: "programming",
  });

  assert.equal(spec.alias, "selected_alias");
  assert.equal(spec.model, "selected-model");
});

test("resolveEffectiveModelSpec falls back to scenario default when selectedModel is invalid", () => {
  const spec = resolveEffectiveModelSpec({
    globalConfig,
    userConfig: {},
    selectedModel: "missing_alias",
    scenario: "programming",
  });

  assert.equal(spec.alias, "scenario_default");
  assert.equal(spec.model, "scenario-default-model");
});

function buildStateWithRunConfig(runConfig) {
  let received = null;
  const builder = createStateBuilder({
    createChatModelFn: () => ({}),
    mergeConfigFn: (a, b) => ({ ...a, ...b }),
    emitEventFn: () => {},
    buildContextMessageBlocksFn: () => ({ system: [], history: [], incremental: [], messages: [] }),
    normalizeSystemRuntimeCountersFn: () => {},
    resolveEffectiveModelSpecFn: (params) => {
      received = params;
      return { alias: "selected_alias", model: "selected-model" };
    },
    resolveMaxToolLoopTurnsFn: () => 1,
    resolvePhaseSummaryLoopTurnsFn: () => 1,
    resolvePhaseSummaryMessageCharsThresholdFn: () => 1,
    resolveHelpPromptLoopTurnsFn: () => 1,
    resolveToolFailureHelpCountFn: () => 1,
  });

  builder({
    agentContext: {
      runtime: {
        globalConfig,
        userConfig: {},
        runConfig,
        systemRuntime: {},
      },
      payload: {
        messages: { history: [] },
        tools: { registry: [] },
      },
    },
    userMessage: { role: "user", content: "hi" },
  });

  return received;
}

test("state builder reads selectedModel from runConfig.config first", () => {
  const received = buildStateWithRunConfig({
    selectedModel: "top_level_alias",
    scenario: "top_level_scenario",
    config: {
      selectedModel: "config_alias",
      scenario: "config_scenario",
    },
  });

  assert.equal(received.selectedModel, "config_alias");
  assert.equal(received.scenario, "config_scenario");
});

test("state builder falls back to top-level selectedModel and scenario", () => {
  const received = buildStateWithRunConfig({
    selectedModel: "selected_alias",
    scenario: "programming",
  });

  assert.equal(received.selectedModel, "selected_alias");
  assert.equal(received.scenario, "programming");
});
