/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createMockBotHookManager,
  getBeforeDispatch,
  registerWorkflowAgentHooks,
  simpleActionWorkflowDsl,
  createTestHookInvocation,
} from "../helpers/workflow-hook-session-strategy-helper.js";
import { parseWorkflowSemantic } from "../../src/workflow/adapter.js";

for (const text of ["", "   ", "invalid DSL"]) {
  test(`semantic output ${JSON.stringify(text)} cannot execute the source DSL`, async () => {
    const sourceText = simpleActionWorkflowDsl();
    assert.ok(parseWorkflowSemantic({ semanticText: sourceText, locale: "en-US" }));
    const hookManager = createMockBotHookManager();
    let childRuns = 0;
    registerWorkflowAgentHooks({
      hookManager,
      config: {
        enabled: true,
        mode: "on",
        resolveModelMessages: () => [],
        capabilityModelInvoker: async () => ({ output: { text } }),
        subSessionRunner: async () => {
          childRuns += 1;
          throw new Error("unexpected child execution");
        },
      },
    });
    const outcome = await getBeforeDispatch(hookManager).handler(
      {
        userId: "u1",
        sessionId: "semantic-output-session",
        dialogProcessId: "semantic-output-dialog",
        userMessage: sourceText,
        userMessageAttachments: [],
        runConfig: { locale: "en-US" },
      },
      createTestHookInvocation(),
    );
    assert.equal(outcome.disposition, "handled");
    assert.equal(outcome.owner, "workflow");
    assert.equal(outcome.failure.code, "WORKFLOW_EXECUTION_FAILED");
    assert.equal(Object.hasOwn(outcome, "result"), false);
    assert.equal(childRuns, 0);
    assert.deepEqual(hookManager.emits, []);
  });
}
