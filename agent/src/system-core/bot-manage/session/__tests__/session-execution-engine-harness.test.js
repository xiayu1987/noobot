import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionExecutionEngine } from "../session-execution-engine.js";

function createWorkspaceService(basePath) {
  return { getWorkspacePath: () => basePath };
}

test("SessionExecutionEngine injects mini-runner capabilityModelInvoker for harness separate_model", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-engine-harness-"));
  const engine = new SessionExecutionEngine({
    globalConfig: {},
    workspaceService: createWorkspaceService(basePath),
  });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: 2,
          miniRunnerToolAllowlist: ["call_service"],
        },
      },
    },
  });

  assert.equal(typeof prepared.hookManager?.emit, "function");
  assert.equal(prepared.plugins.harness.enabled, true);
  assert.equal(prepared.plugins.harness.basePath, basePath);
  assert.equal(prepared.plugins.harness.planningGuidanceMode, "separate_model");
  assert.equal(typeof prepared.plugins.harness.capabilityModelInvoker, "function");
});

test("SessionExecutionEngine preserves explicit harness capabilityModelInvoker", async () => {
  const explicitInvoker = async () => ({ output: "ok" });
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          capabilityModelInvoker: explicitInvoker,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.capabilityModelInvoker, explicitInvoker);
});

test("SessionExecutionEngine defaults harness miniRunnerMaxTurns to 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.miniRunnerMaxTurns, 5);
});

test("SessionExecutionEngine caps harness miniRunnerMaxTurns at 5", async () => {
  const engine = new SessionExecutionEngine({ globalConfig: {} });

  const prepared = engine._prepareHarnessRunConfig({
    userId: "u1",
    runConfig: {
      plugins: {
        harness: {
          enabled: true,
          mode: "on",
          planningGuidanceMode: "separate_model",
          miniRunnerMaxTurns: 99,
        },
      },
    },
  });

  assert.equal(prepared.plugins.harness.miniRunnerMaxTurns, 5);
});
