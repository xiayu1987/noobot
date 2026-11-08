/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import { MODEL_CONTEXT_SEQUENCE_POLICY, MODEL_REQUEST_EVENT } from "@noobot/model-protocol";
import { summarizeExecutionMetrics } from "../../src/observability/execution-log/execution-report-metrics.js";

test("Anthropic server-tool continuation counts every HTTP request within one model attempt", async () => {
  const logs = [];
  const bodies = [];
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test-key" },
    observationPort: { emit: (event, data) => logs.push({ event, data }) },
    providerRuntime: {
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return Response.json({
          stop_reason: bodies.length === 1 ? "pause_turn" : "end_turn",
          content: [{ type: "text", text: bodies.length === 1 ? "partial " : "final" }],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: bodies.length === 1 ? 0 : 80,
            cache_creation_input_tokens: 10,
          },
        });
      },
    },
  });
  const result = await executor.invoke({
    invocation: {
      requestId: "request",
      invocationId: "invocation",
      sessionId: "session",
      parentSessionId: "",
      dialogProcessId: "dialog",
      turnScopeId: "turn",
      runId: "run",
      flow: "test",
      purpose: "test",
      domain: "test",
      contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
    },
    model: {
      model: "claude-test",
      operatorId: "anthropic",
      adapterId: "anthropic-messages",
      base_url: "https://provider.test",
      capabilities: { web_search: true },
      modelFamily: "claude",
      reasoning_effort: "none",
      reasoning_effort_options: ["none"],
      reasoning_effort_parameter: "reasoning_effort",
    },
    operation: { kind: "web_search", input: { query: "test" } },
    messages: [],
  });
  assert.equal(result.result.rawText, "partial final");
  assert.equal(result.execution.attempts.length, 1);
  assert.equal(bodies.length, 2);
  const starts = logs.filter(({ event }) => event === MODEL_REQUEST_EVENT.STARTED);
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0].data.transportRequestId, starts[1].data.transportRequestId);
  assert.equal(starts[1].data.attempt, 1);
  assert.equal(starts[1].data.prefix.baseline, "available");
  assert.ok(starts[1].data.prefix.commonPrefixBytes > 0);
  const model = summarizeExecutionMetrics(logs).model;
  assert.equal(model.invocations, 1);
  assert.equal(model.retries, 0);
  assert.equal(model.measurements.requests.startedCount, 2);
  assert.equal(model.measurements.requests.completedCount, 2);
  assert.equal(model.measurements.usage.tokens.inputTokensSum, 120);
  assert.equal(model.measurements.usage.tokens.outputTokensSum, 10);
  assert.equal(model.measurements.usage.cacheRead.cacheReadInputTokensSum, 80);
  assert.equal(model.measurements.usage.cacheWrite.cacheWriteInputTokensSum, 20);
});
