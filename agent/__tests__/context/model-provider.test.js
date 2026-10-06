/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { mergeConfig } from "../../src/config/index.js";
import { resolveModelSection } from "../../src/context/providers/model-provider.js";
import { buildModelsSection } from "../../src/tools/collaboration/help-sections.js";

function provider(alias, model) {
  return {
    enabled: true,
    providerId: alias,
    adapterId: "openai-compatible",
    model,
    reasoning_effort_parameter: "reasoning_effort",
    reasoning_effort_options: ["none", "low", "medium", "high"],
    apiKey: "test-key",
    baseUrl: `http://localhost/${alias}`,
  };
}

const globalConfig = {
  providers: {
    system_default: provider("system_default", "system-default-model"),
    scenario_model: provider("scenario_model", "scenario-model"),
    selected_alias: provider("selected_alias", "selected-model"),
  },
  scenarios: { definitions: { programming: { model: "scenario_model" } } },
  defaultProvider: "system_default",
};
const effectiveConfig = mergeConfig(globalConfig, {});

test("resolveModelSection current uses this turn's selectedModel, not config default", () => {
  const section = resolveModelSection({
    globalConfig,
    userConfig: {},
    effectiveConfig,
    selectedModel: "selected_alias",
    scenario: "programming",
  });
  assert.equal(section.current.alias, "selected_alias");
  assert.equal(section.current.name, "selected-model");
});

test("resolveModelSection current falls back to scenario model when nothing selected", () => {
  const section = resolveModelSection({
    globalConfig,
    userConfig: {},
    effectiveConfig,
    scenario: "programming",
  });
  assert.equal(section.current.alias, "scenario_model");
});

test("help --models section resolves current model from runtime.runConfig", () => {
  const section = buildModelsSection({
    bindings: {
      runtime: {
        globalConfig,
        userConfig: {},
        runConfig: { selectedModel: "selected_alias", scenario: "programming" },
      },
    },
  });
  assert.equal(section.current.alias, "selected_alias");
});
