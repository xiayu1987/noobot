/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RunConfigResolver } from "@noobot/agent-config-protocol";
import { migrateHarnessBucket } from "../../src/core/bucket-migration.js";
import {
  resolveWorkflowThresholdModeFromContext,
  resolveScenarioPolicyFlagsFromContext,
} from "../../src/capabilities/handlers/shared/workflow/matrix-resolver.js";
import { applyDynamicPolicyPromptFromText } from "../../src/capabilities/handlers/shared/workflow/dynamic-policy-prompt.js";
import { buildDefaultPolicyPrompt } from "../../src/tracing/policy-prompt-matrix.js";
import { resolveGuidanceSummaryPromptProtocolSelection } from "../../src/capabilities/handlers/shared/workflow/summary-matrix.js";

for (const scenario of ["full", "text", "programming"]) {
  test(`resolved ${scenario} configuration reaches Bot and Agent hooks`, () => {
    const runConfig = new RunConfigResolver().resolveScenarioRunConfig({ scenario });
    assert.equal(runConfig.scenarioProfile.key, scenario);
    const agentContext = { bindings: { runtime: { runConfig } } };
    const botHook = { runConfig, agentContext };
    const agentHook = { agentContext };
    assert.equal(resolveWorkflowThresholdModeFromContext(botHook), scenario);
    assert.equal(resolveWorkflowThresholdModeFromContext(agentHook), scenario);
    assert.deepEqual(
      resolveScenarioPolicyFlagsFromContext(botHook),
      resolveScenarioPolicyFlagsFromContext(agentHook),
    );
  });
}

test("explicit Bot configuration is not replaced by stale runtime or profile fields", () => {
  const ctx = {
    runConfig: { scenario: "full", scenarioProfile: { key: "text" }, scenarioKey: "text" },
    agentContext: { bindings: { runtime: { runConfig: { scenario: "programming" } } } },
  };
  assert.equal(resolveWorkflowThresholdModeFromContext(ctx), "full");
  assert.equal(resolveScenarioPolicyFlagsFromContext(ctx).scenario, "general");
  ctx.runConfig = {};
  assert.equal(resolveWorkflowThresholdModeFromContext(ctx), "full");
});

test("profile and unwritten context paths cannot supply a missing scenario", () => {
  const ctx = {
    runConfig: { scenarioProfile: { key: "programming" }, scenarioKey: "programming" },
    agentContext: {
      runConfig: { scenario: "text" },
      bindings: { runtime: { systemRuntime: { runConfig: { scenario: "programming" } } } },
    },
  };
  assert.equal(resolveWorkflowThresholdModeFromContext(ctx), "full");
  delete ctx.runConfig;
  assert.equal(resolveWorkflowThresholdModeFromContext(ctx), "full");
});

for (const initialScenario of ["text", "programming"]) {
  test(`dynamic general policy replaces initial ${initialScenario} prompt modes`, () => {
    const bucket = {};
    applyDynamicPolicyPromptFromText(
      bucket,
      "[HARNESS_DYNAMIC_POLICY_PROMPT]\nscenario = general\nreason = changed intent\nprompt:\nUse general task handling.\n[/HARNESS_DYNAMIC_POLICY_PROMPT]",
      { source: "planning", stage: "planning" },
    );
    const ctx = {
      agentContext: {
        bindings: {
          runtime: { runConfig: { scenario: initialScenario } },
          extensions: { harness: bucket },
        },
      },
    };
    migrateHarnessBucket(ctx);
    const flags = resolveScenarioPolicyFlagsFromContext(ctx);
    assert.equal(flags.scenario, "general");
    assert.equal(flags.dynamicPolicyPrompt, "Use general task handling.");
    assert.equal(resolveGuidanceSummaryPromptProtocolSelection(flags).scenario, "general");
    const mainPrompt = buildDefaultPolicyPrompt("en-US", ctx);
    assert.match(mainPrompt, /scenario = general/);
    assert.match(mainPrompt, /policy_prompt = harness_policy\/dynamic\/general/);
    assert.match(mainPrompt, /Use general task handling\./);
    assert.equal(resolveWorkflowThresholdModeFromContext(ctx), initialScenario);
  });
}
