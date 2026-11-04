/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHarnessBucket } from "../../src/core/bucket-contract.js";
import { appendCapabilityLog } from "../../src/capabilities/handlers/shared/attachment-log-utils.js";
import { runWorkflowLifecycle } from "../../src/capabilities/handlers/shared/workflow/pattern.js";
import { WORKFLOW_PARAMS } from "../../src/core/workflow-params.js";

function fixture() {
  const bucket = createHarnessBucket();
  const ctx = { agentContext: { bindings: { extensions: { harness: bucket } } } };
  const append = (event) => appendCapabilityLog(ctx, { domain: "guidance", event });
  return { ctx, logs: bucket.logs.guidance, append };
}

test("workflow metrics count current retries and retain the first current error", async () => {
  const { ctx, logs, append } = fixture();
  const retry = WORKFLOW_PARAMS.workflow.events.reasoningRetryScheduled;
  append("old_failed");
  append(retry);
  const decision = { chosenAction: "guide" };
  const execution = { requestedAction: "guide_inject", executedPrimary: true, changed: true };
  const result = await runWorkflowLifecycle(ctx, {
    domain: "guidance",
    resolveDecision: () => decision,
    execute: async (chosen) => {
      assert.equal(chosen, decision);
      append("progress");
      append(retry);
      append("first_failed");
      append("progress");
      append(retry);
      append("second_error");
      return execution;
    },
  });
  assert.equal(result.decision, decision);
  assert.deepEqual(result.execution, { ...execution, executedFollowup: false });
  assert.deepEqual(result.metrics, { retryCount: 2, errorCode: "FIRST_FAILED" });
  const finalLog = logs.at(-1);
  assert.equal(finalLog.event, WORKFLOW_PARAMS.workflow.events.executionResult);
  assert.equal(finalLog.detail.retryCount, 2);
  assert.equal(finalLog.detail.errorCode, "FIRST_FAILED");
});

test("workflow propagates every rejection value and still records completion", async () => {
  for (const reason of [null, undefined, false, 0, "", new Error("execution failed")]) {
    const { ctx, logs } = fixture();
    const outcome = await runWorkflowLifecycle(ctx, {
      domain: "guidance",
      execute: async () => {
        throw reason;
      },
    }).then(
      () => ({ status: "fulfilled" }),
      (error) => ({ status: "rejected", error }),
    );
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error, reason);
    assert.equal(logs.at(-1).event, WORKFLOW_PARAMS.workflow.events.executionResult);
    assert.equal(logs.at(-1).detail.executedPrimary, false);
    assert.equal(logs.at(-1).detail.errorCode, reason instanceof Error ? "ERROR" : undefined);
    assert.equal(
      logs.filter((entry) => entry.event === WORKFLOW_PARAMS.workflow.events.executionResult)
        .length,
      1,
    );
  }
});

test("workflow records thrown error codes when execution emits no error event", async () => {
  const { ctx, logs } = fixture();
  const reason = Object.assign(new Error("execution failed"), { code: "model-unavailable" });
  await assert.rejects(
    runWorkflowLifecycle(ctx, {
      domain: "guidance",
      execute: async () => {
        throw reason;
      },
    }),
    (error) => error === reason,
  );
  assert.equal(logs.at(-1).detail.errorCode, "MODEL_UNAVAILABLE");
});

test("workflow event error takes priority over a later thrown error code", async () => {
  const { ctx, logs, append } = fixture();
  const reason = Object.assign(new Error("execution failed"), { code: "later-error" });
  await assert.rejects(
    runWorkflowLifecycle(ctx, {
      domain: "guidance",
      execute: async () => {
        append("first_failed");
        throw reason;
      },
    }),
    (error) => error === reason,
  );
  assert.equal(logs.at(-1).detail.errorCode, "FIRST_FAILED");
});
