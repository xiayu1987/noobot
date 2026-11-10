/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createModelRequestExecutor } from "@noobot/model-runtime";
import {
  MODEL_CONTEXT_SEQUENCE_POLICY,
  MODEL_REQUEST_EVENT,
  createUnavailableModelUsage,
} from "@noobot/model-protocol";
import { buildExecutionReport } from "@noobot/session-protocol/execution-report";
import { summarizeExecutionMetrics } from "../../src/observability/execution-log/execution-report-metrics.js";
import { createModelRequestMetrics } from "../../src/observability/execution-log/model-request-metrics.js";
import {
  writeExecutionReportArtifact,
  readExecutionReportArtifact,
} from "../../src/session/session-artifact-session/related-artifact-writer.js";
import { TEST_STORAGE_SERVICE } from "../helpers/storage-service.js";

const invocation = {
  requestId: "r",
  invocationId: "i",
  sessionId: "s",
  parentSessionId: "",
  dialogProcessId: "d",
  turnScopeId: "t",
  runId: "run",
  flow: "test",
  purpose: "test",
  domain: "test",
  contextSequencePolicy: MODEL_CONTEXT_SEQUENCE_POLICY.INDEPENDENT_REQUEST,
};
const reportFor = (logs) =>
  buildExecutionReport({
    status: "completed",
    sessionId: "s",
    dialogProcessId: "d",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    executionSummary: {
      visibleTotal: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      errorCount: 0,
      metrics: summarizeExecutionMetrics(logs),
    },
  });

test("HTTP attempts including semantic and transport retries reach the persisted execution report", async (t) => {
  const logs = [];
  let calls = 0;
  const executor = createModelRequestExecutor({
    credentialPort: { resolve: () => "test" },
    observationPort: { emit: (event, data) => logs.push({ event, data }) },
    clock: { now: () => 0, sleep: async () => {} },
    providerRuntime: {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("reset"), { code: "ECONNRESET" });
        return new Response(
          JSON.stringify({
            content: calls === 2 ? "" : "done",
            choices: [{ index: 0, finish_reason: "stop" }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              prompt_tokens_details: { cached_tokens: calls === 2 ? 0 : 80 },
            },
          }),
        );
      },
    },
    registry: {
      resolve: () => ({
        id: "openai-compatible",
        classifyError: () => ({ kind: "temporary_unavailable" }),
        prepareMessages: ({ messages }) => messages,
        bindTools: ({ client }) => client,
        resolveResponseSource: () => "message",
        createClient: ({ fetch }) => ({
          invoke: async () => {
            const result = await (
              await fetch("https://provider.test/v1/chat/completions", {
                method: "POST",
                body: '{"messages":[]}',
              })
            ).json();
            return { content: result.content };
          },
        }),
      }),
    },
  });
  const response = await executor.invoke({
    invocation,
    model: { model: "m", operatorId: "test", adapterId: "test" },
    messages: [],
  });
  assert.equal(response.output.text, "done");
  assert.equal(calls, 3);
  const report = reportFor(logs);
  const measurements = report.summary.metrics.model.measurements;
  assert.equal(report.summary.metrics.model.retries, 2);
  assert.deepEqual(measurements.requests, {
    startedCount: 3,
    completedCount: 2,
    failedCount: 1,
    cancelledCount: 0,
    unfinishedCount: 0,
  });
  assert.equal(measurements.usage.tokens.inputTokensSum, 200);
  assert.equal(measurements.usage.tokens.outputTokensSum, 20);
  assert.equal(measurements.usage.tokens.sampleCount, 2);
  assert.equal(measurements.usage.tokens.unavailableReasons.transport_failed, 1);
  assert.equal(measurements.usage.cacheRead.cacheReadInputTokensSum, 80);
  assert.equal(
    measurements.requestPrefix.commonPrefixBytesSum,
    Buffer.byteLength('{"messages":[]}') * 2,
  );
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-report-usage-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  await writeExecutionReportArtifact({
    storageService: TEST_STORAGE_SERVICE,
    sessionDir,
    reportPayload: report,
    atomic: true,
  });
  assert.deepEqual(
    await readExecutionReportArtifact({
      storageService: TEST_STORAGE_SERVICE,
      sessionDir,
      dialogProcessId: "d",
    }),
    report,
  );
});

test("v5 artifacts migrate in memory without writes or fabricated historical usage", async (t) => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-report-migrate-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const { artifactPath } = await writeExecutionReportArtifact({
    storageService: TEST_STORAGE_SERVICE,
    sessionDir,
    reportPayload: reportFor([]),
    atomic: true,
  });
  const historical = JSON.parse(await readFile(artifactPath, "utf8"));
  historical.version = 5;
  delete historical.summary.metrics.model.measurements;
  await writeFile(artifactPath, JSON.stringify(historical));
  let writes = 0;
  const storageService = Object.create(TEST_STORAGE_SERVICE);
  storageService.writeJsonAtomic = async (...args) => {
    writes += 1;
    return TEST_STORAGE_SERVICE.writeJsonAtomic(...args);
  };
  const report = await readExecutionReportArtifact({
    storageService,
    sessionDir,
    dialogProcessId: "d",
  });
  assert.equal(report.version, 6);
  assert.deepEqual(report.summary.metrics.model.measurements, { state: "legacy_not_collected" });
  assert.deepEqual(JSON.parse(await readFile(artifactPath, "utf8")), historical);
  await readExecutionReportArtifact({ storageService, sessionDir, dialogProcessId: "d" });
  assert.equal(writes, 0);
});

test("historical report reads work with read-only storage and preserve source bytes", async (t) => {
  const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-report-migrate-fail-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const { artifactPath } = await writeExecutionReportArtifact({
    storageService: TEST_STORAGE_SERVICE,
    sessionDir,
    reportPayload: reportFor([]),
    atomic: true,
  });
  const historical = { ...reportFor([]), version: 5 };
  delete historical.summary.metrics.model.measurements;
  await writeFile(artifactPath, JSON.stringify(historical));
  const storageService = Object.create(TEST_STORAGE_SERVICE);
  storageService.writeJsonAtomic = async () => {
    throw new Error("migration disk failure");
  };
  const report = await readExecutionReportArtifact({
    storageService,
    sessionDir,
    dialogProcessId: "d",
  });
  assert.equal(report.version, 6);
  assert.equal(await readFile(artifactPath, "utf8"), JSON.stringify(historical));
});

test("unpaired and duplicate measurement events fail explicitly; unfinished requests retain their coverage gap", () => {
  const identity = { transportRequestId: "h", attempt: 1, operationKind: "chat", invocation };
  const start = {
    event: MODEL_REQUEST_EVENT.STARTED,
    data: { ...identity, prefix: { state: "unavailable", reason: "unsupported" } },
  };
  const usage = {
    event: MODEL_REQUEST_EVENT.USAGE,
    data: {
      ...identity,
      usage: createUnavailableModelUsage("provider_not_reported"),
      measurementError: null,
    },
  };
  assert.throws(() => summarizeExecutionMetrics([usage]), /unpaired/);
  assert.throws(() => summarizeExecutionMetrics([start, start]), /duplicate/);
  assert.throws(() => summarizeExecutionMetrics([start, usage, usage]), /duplicate/);
  const result = summarizeExecutionMetrics([start]).model.measurements;
  assert.equal(result.requests.unfinishedCount, 1);
  assert.equal(result.usage.tokens.unavailableReasons.unfinished, 1);
});

test("diagnostic-free measurement failure is rejected at consume without poisoning the request", () => {
  const metrics = createModelRequestMetrics();
  const identity = { transportRequestId: "h", attempt: 1, invocation };
  metrics.consume(MODEL_REQUEST_EVENT.STARTED, {
    ...identity,
    prefix: { state: "unavailable", reason: "unsupported" },
  });
  assert.throws(
    () =>
      metrics.consume(MODEL_REQUEST_EVENT.USAGE, {
        ...identity,
        usage: createUnavailableModelUsage("measurement_failed"),
        measurementError: null,
      }),
    /requires measurementError diagnostic/,
  );
  metrics.consume(MODEL_REQUEST_EVENT.USAGE, {
    ...identity,
    usage: null,
    measurementError: "invalid provider usage",
  });
  metrics.consume(MODEL_REQUEST_EVENT.FINISHED, { ...identity, status: "completed" });
  const result = metrics.summarize();
  assert.equal(result.usage.tokens.unavailableReasons.measurement_failed, 1);
  assert.deepEqual(result.measurementErrors, [
    { transportRequestId: "h", message: "invalid provider usage" },
  ]);
});

for (const fault of ["http", "measurement"]) {
  test(`${fault} failure followed by success reaches report storage with explicit diagnostics`, async (t) => {
    const logs = [];
    let calls = 0;
    const executor = createModelRequestExecutor({
      credentialPort: { resolve: () => "test" },
      observationPort: { emit: (event, data) => logs.push({ event, data }) },
      clock: { now: () => 0, sleep: async () => {} },
      providerRuntime: {
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1 && fault === "http") return new Response("rate limited", { status: 429 });
          return Response.json({
            content: calls === 1 ? "" : "done",
            choices: [{ index: 0, finish_reason: "stop" }],
            usage: {
              prompt_tokens: calls === 1 ? -1 : 10,
              completion_tokens: 0,
            },
          });
        },
      },
      registry: {
        resolve: () => ({
          id: "openai-compatible",
          classifyError: () => ({ kind: "temporary_unavailable" }),
          prepareMessages: ({ messages }) => messages,
          bindTools: ({ client }) => client,
          resolveResponseSource: () => "message",
          createClient: ({ fetch }) => ({
            invoke: async () => {
              const response = await fetch("https://provider.test/v1/chat/completions", {
                method: "POST",
                body: "{}",
              });
              if (!response.ok) throw new Error(await response.text());
              return { content: (await response.json()).content };
            },
          }),
        }),
      },
    });
    const response = await executor.invoke({
      invocation,
      model: { model: "m", operatorId: "test", adapterId: "test" },
      messages: [],
    });
    assert.equal(response.output.text, "done");
    assert.equal(Object.hasOwn(response.output, "usage"), false);
    const report = reportFor(logs);
    const measurements = report.summary.metrics.model.measurements;
    assert.equal(measurements.requests.startedCount, 2);
    assert.equal(measurements.requests.failedCount, fault === "http" ? 1 : 0);
    assert.equal(measurements.usage.tokens.sampleCount, 1);
    assert.equal(measurements.usage.tokens.outputTokensSum, 0);
    assert.equal(
      measurements.usage.tokens.unavailableReasons[
        fault === "http" ? "request_failed" : "measurement_failed"
      ],
      1,
    );
    assert.equal(measurements.measurementErrors.length, fault === "measurement" ? 1 : 0);
    if (fault === "measurement")
      assert.match(measurements.measurementErrors[0].message, /non-negative/);
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "noobot-report-fault-"));
    t.after(() => rm(sessionDir, { recursive: true, force: true }));
    await writeExecutionReportArtifact({
      storageService: TEST_STORAGE_SERVICE,
      sessionDir,
      reportPayload: report,
      atomic: true,
    });
    assert.deepEqual(
      await readExecutionReportArtifact({
        storageService: TEST_STORAGE_SERVICE,
        sessionDir,
        dialogProcessId: "d",
      }),
      report,
    );
  });
}
