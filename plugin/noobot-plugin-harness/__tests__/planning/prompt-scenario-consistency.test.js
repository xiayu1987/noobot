/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePromptOptions } from "../../src/capabilities/handlers/shared/workflow/prompt-options.js";
import { buildPlanningMainPrompt } from "../../src/capabilities/handlers/shared/workflow/planning-prompts.js";
import {
  buildGuidanceSummaryPromptText,
  buildGuidanceSummaryProtocolPromptText,
} from "../../src/capabilities/handlers/shared/workflow/guidance-prompts.js";
import { resolveGuidanceSummaryPromptProtocolSelection } from "../../src/capabilities/handlers/shared/workflow/summary-matrix.js";

import { resolvePolicyPromptSelection } from "../../src/tracing/policy-prompt-matrix.js";
import { buildScenarioPolicyPromptText } from "../../src/capabilities/handlers/shared/workflow/scenario-policy-prompts.js";

const cases = [
  { name: "programming scenario", options: { scenario: "programming" }, scenario: "programming" },
  { name: "unused programming key", options: { scenarioKey: "programming" }, scenario: "general" },
  {
    name: "programming profile",
    options: { scenarioProfile: { key: "programming" } },
    scenario: "general",
  },
  {
    name: "nested programming scenario",
    options: { data: { scenario: "programming" } },
    scenario: "general",
  },
  {
    name: "nested programming key",
    options: { data: { scenarioKey: "programming" } },
    scenario: "general",
  },
  {
    name: "nested programming profile",
    options: { data: { scenarioProfile: { key: "programming" } } },
    scenario: "general",
  },
  {
    name: "scenario precedes profile",
    options: { scenario: "programming", scenarioProfile: { key: "text" } },
    scenario: "programming",
  },
  {
    name: "unused text profile",
    options: { scenarioProfile: { key: "text" } },
    scenario: "general",
  },
  { name: "text scenario", options: { scenario: "text" }, scenario: "text" },
  {
    name: "unused mode flags",
    options: { programmingMode: true, textMode: true },
    scenario: "general",
  },
  { name: "unused mode alias", options: { isProgrammingMode: true }, scenario: "general" },
  { name: "unused nested scenario", options: { data: { scenario: "text" } }, scenario: "general" },
  { name: "general scenario", options: { scenario: "general" }, scenario: "general" },
];

for (const { name, options, scenario } of cases) {
  test(`prompt and summary protocol agree on ${name}`, () => {
    const canonical = { ...options, scenario };
    assert.equal(normalizePromptOptions(options).scenario, scenario);
    const selection = resolveGuidanceSummaryPromptProtocolSelection(options);
    assert.equal(selection.scenario, scenario);
    assert.equal(selection.protocolId, `summary_patch_v1/${scenario}`);
    assert.match(
      buildScenarioPolicyPromptText("en-US", options),
      new RegExp(`scenario = ${scenario}`),
    );
    assert.equal(buildPlanningMainPrompt(options), buildPlanningMainPrompt(canonical));
    assert.equal(
      buildGuidanceSummaryPromptText(options),
      buildGuidanceSummaryPromptText(canonical),
    );
    assert.equal(
      buildGuidanceSummaryProtocolPromptText(options),
      buildGuidanceSummaryProtocolPromptText(canonical),
    );
  });
}

test("explicit general scenario overrides runtime", () => {
  const ctx = { runConfig: { scenario: "programming" } };
  assert.equal(resolvePolicyPromptSelection(ctx, { scenario: "general" }).scenario, "general");
  assert.equal(resolvePolicyPromptSelection(ctx).scenario, "programming");
});
