/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveEffectiveModelSpec } from "../../src/runtime/run-config/config-resolver.js";
import { createStateBuilder } from "../../src/runtime/state-builder.js";
import { createTestAgentExecutionScope } from "../helpers/agent-execution-scope.js";

const globalConfig = {
  providers: {
    scenario_default: {
      enabled: true,
      format: "openai_compatible",
      providerId: "scenario_default",
      adapterId: "openai-compatible",
      model: "scenario-default-model",
      apiKey: "test-key",
      baseUrl: "http://localhost/scenario",
    },
    selected_alias: {
      enabled: true,
      format: "openai_compatible",
      providerId: "selected_alias",
      adapterId: "openai-compatible",
      model: "selected-model",
      apiKey: "test-key",
      baseUrl: "http://localhost/selected",
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

test("resolveEffectiveModelSpec uses the configured default when selectedModel is invalid", () => {
  const spec = resolveEffectiveModelSpec({
    globalConfig,
    userConfig: {},
    selectedModel: "missing_alias",
    scenario: "programming",
  });

  assert.equal(spec.alias, "scenario_default");
  assert.equal(spec.model, "scenario-default-model");
});

test("resolveEffectiveModelSpec rejects an invalid selection when no configured default exists", () => {
  assert.throws(
    () =>
      resolveEffectiveModelSpec({
        globalConfig: {
          ...globalConfig,
          defaultProvider: "",
        },
        userConfig: {},
        selectedModel: "missing_alias",
        scenario: "programming",
      }),
    /selected model not found and no configured default model is available: missing_alias/,
  );
});

test("resolveEffectiveModelSpec uses scenario model as initial model fallback", () => {
  const spec = resolveEffectiveModelSpec({
    globalConfig: {
      providers: {
        scenario_model_alias: {
          enabled: true,
          format: "openai_compatible",
          providerId: "scenario_model_alias",
          adapterId: "openai-compatible",
          model: "scenario-model",
          apiKey: "test-key",
          baseUrl: "http://localhost/scenario-model",
        },
        system_default: {
          enabled: true,
          format: "openai_compatible",
          providerId: "system_default",
          adapterId: "openai-compatible",
          model: "system-default-model",
          apiKey: "test-key",
          baseUrl: "http://localhost/system",
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
      defaultModelAlias: "system_default",
    },
    userConfig: {},
    selectedModel: "",
    scenario: "programming",
  });

  assert.equal(spec.alias, "scenario_model_alias");
  assert.equal(spec.model, "scenario-model");
});

function buildStateWithRunConfig(runConfig) {
  let received = null;
  const builder = createStateBuilder({
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
    agentContext: createTestAgentExecutionScope({
      globalConfig,
      userConfig: {},
      runConfig,
      systemRuntime: {
        sessionId: "s1",
        dialogProcessId: "dialog-model-selection",
        turnScopeId: "turn-model-selection",
      },
    }),
    currentUserMessage: {
      messageUid: "sm_model_selection",
      role: "user",
      content: "hi",
      dialogProcessId: "dialog-model-selection",
      turnScopeId: "turn-model-selection",
    },
  });

  return received;
}

test("state builder reads selectedModel and scenario only from canonical runConfig fields", () => {
  const received = buildStateWithRunConfig({
    selectedModel: "top_level_alias",
    scenario: "top_level_scenario",
  });

  assert.equal(received.selectedModel, "top_level_alias");
  assert.equal(received.scenario, "top_level_scenario");
});

test("state builder accepts canonical selectedModel and scenario", () => {
  const received = buildStateWithRunConfig({
    selectedModel: "selected_alias",
    scenario: "programming",
  });

  assert.equal(received.selectedModel, "selected_alias");
  assert.equal(received.scenario, "programming");
});
