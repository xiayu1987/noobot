/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  sendMessage,
  waitForNaturalCompletion,
  setMainSummaryTurnsThreshold,
  selectPlugins,
} from "../helpers/browser-actions.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";
import { findAgentCommands, findLifecycleEnvelopes } from "../helpers/websocket-capture.js";
import {
  readSessionExecutionEvents,
  readSessionExecutionEventTree,
  modelInvocationTraces,
} from "../helpers/persistence-audit.js";
import {
  assertCanonicalToolPairs,
  toolEventsForTurn,
} from "../helpers/thinking-tool-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { runOpsWorkdirPath } from "../helpers/run-ops-workdir.js";
import { BUILTIN_TOOL_IDS } from "../../../../../../agent/src/tools/constants/index.js";
import {
  PERF_TOOLS,
  PERF_ALL_TOOLS,
  PERF_SCENARIO,
  PERF_EXCLUSIONS,
  PERF_REPETITIONS,
  scenarioSteps,
} from "../../../../../../scripts/mock-model-service/scenario.mjs";
import { evaluatePerformance } from "../../../../../../scripts/e2e-docker/performance-gate.mjs";
import { DEVELOPMENT_THRESHOLDS } from "../../../../../../scripts/lib/development-thresholds.mjs";

function lifecycleTime(capture, turnScopeId, eventType) {
  const frame = capture.websocketReceived.find((record) =>
    findLifecycleEnvelopes([record]).some(
      (event) => event.turnScopeId === turnScopeId && event.eventType === eventType,
    ),
  );
  expect(frame, `missing ${eventType}`).toBeTruthy();
  return frame.atMs;
}

async function runRound(noobot, capture, testInfo, round, connectorId) {
  const before = commandsForSession(capture, noobot.sessionId).length;
  const filePath = runOpsWorkdirPath(`perf-${round}.txt`);
  await sendMessage(
    noobot.page,
    uniquePrompt(testInfo, `NOOBOT_PERF_CASE:${filePath} NOOBOT_PERF_CONNECTOR:${connectorId}`),
  );
  const command = await waitForCommand(capture, noobot.sessionId, "turn.send", before);
  const sent = capture.websocketSent.find((record) =>
    findAgentCommands([record]).some((item) => item.commandId === command.commandId),
  );
  const turnScopeId = command.identity.turnScopeId;
  for (let index = 0; index < PERF_REPETITIONS; index += 1) {
    const interaction = noobot.page
      .locator(".interaction-card")
      .filter({ has: noobot.page.locator(".el-input input:enabled") });
    await expect(interaction).toBeVisible({
      timeout: DEVELOPMENT_THRESHOLDS.performance.warmTurnMaxMs,
    });
    await interaction.locator(".el-input input").fill("NOOBOT-PERF-ANSWER");
    await interaction.locator(".el-button--primary").click();
    await expect(interaction).toHaveCount(0);
  }
  await waitForNaturalCompletion({
    page: noobot.page,
    capture,
    sessionId: noobot.sessionId,
    turnScopeId,
    timeoutMs: DEVELOPMENT_THRESHOLDS.performance.warmTurnMaxMs,
  });
  await expect(
    noobot.page.getByRole("paragraph").filter({ hasText: `NOOBOT-PERF-DONE:${filePath}` }),
  ).toBeVisible();
  const uiAtMs = performance.now();
  const records = await readSessionExecutionEvents(noobot.userId, noobot.sessionId);
  const events = toolEventsForTurn(records, turnScopeId);
  const expected = Array.from({ length: PERF_REPETITIONS }, () => [
    ...scenarioSteps(filePath, connectorId).map((step) => step.name),
    "task_summary",
  ]).flat();
  const { calls, results } = assertCanonicalToolPairs(events, expected);
  expect(calls.map((event) => event.data.tool)).toEqual(expected);
  for (const result of results) expect(result.data.success, result.data.result).toBe(true);
  const traces = modelInvocationTraces(
    await readSessionExecutionEventTree(noobot.userId, noobot.sessionId),
  );
  const mainRequests = traces.filter(
    (trace) => trace.sessionId === noobot.sessionId && trace.turnScopeId === turnScopeId,
  );
  const primaryRequests = mainRequests.filter(
    (trace) => trace.data.invocation?.flow === "agent.main",
  );
  expect(primaryRequests).toHaveLength(expected.length + 1);
  for (const trace of mainRequests)
    expect(trace.data.attempt, "model retries are forbidden in the replay").toBe(1);
  const terminal = lifecycleTime(capture, turnScopeId, "turn.completed");
  const firstTool = capture.websocketReceived.find(
    (record) =>
      String(record.payload).includes("tool_call_start") &&
      String(record.payload).includes(turnScopeId),
  );
  expect(firstTool, "first tool must reach the browser").toBeTruthy();
  const metrics = {
    acceptedMs: lifecycleTime(capture, turnScopeId, "turn.action_accepted") - sent.atMs,
    processingMs: lifecycleTime(capture, turnScopeId, "turn.processing_started") - sent.atMs,
    firstToolMs: firstTool.atMs - sent.atMs,
    totalMs: terminal - sent.atMs,
    uiReadyMs: Math.max(0, uiAtMs - terminal),
  };
  const toolSamples = Object.fromEntries(
    PERF_ALL_TOOLS.map((name) => [
      name,
      results.filter((result) => result.data.tool === name).map((result) => result.data.durationMs),
    ]),
  );
  for (const [name, values] of Object.entries(toolSamples)) {
    expect(values, `${name} repetitions`).toHaveLength(PERF_REPETITIONS);
    metrics[`tool.${name}`] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const diagnostics = diagnoseRound(records.filter((event) => event.turnScopeId === turnScopeId));
  const scoped = records.filter((event) => event.turnScopeId === turnScopeId);
  const checkpoints = scoped.filter((event) => event.event === "timeline_checkpoint_persisted");
  expect(checkpoints).toHaveLength(expected.length * 3 + 1);
  metrics.checkpointMs =
    checkpoints.reduce((sum, event) => sum + event.data.durationMs, 0) / checkpoints.length;
  expect(scoped.filter((event) => event.event === "phase_summary_required")).toHaveLength(
    PERF_REPETITIONS,
  );
  expect(scoped.filter((event) => event.event === "summary_checkpoint_committed")).toHaveLength(
    PERF_REPETITIONS,
  );
  return {
    round,
    turnScopeId,
    metrics,
    diagnostics,
    toolSamples,
    modelRequestCount: primaryRequests.length,
    auxiliaryModelRequestCount: mainRequests.length - primaryRequests.length,
    summaryCount: scoped.filter((event) => event.event === "summary_checkpoint_committed").length,
    toolCount: results.length,
    serverToolEvents: events,
  };
}

function diagnoseRound(events) {
  const starts = new Map();
  const phases = { modelPreparationMs: 0, modelTransportMs: 0, modelCompletionMs: 0 };
  const phasePairs = {
    "model.invocation.started": ["modelPreparationMs", "model.request.started"],
    "model.request.started": ["modelTransportMs", "model.request.finished"],
    "model.request.finished": ["modelCompletionMs", "model.invocation.completed"],
  };
  for (const event of events) {
    const id = event.data?.invocation?.invocationId;
    if (!id) continue;
    for (const [start, [metric, end]] of Object.entries(phasePairs)) {
      const key = `${id}:${metric}`;
      if (event.event === start) starts.set(key, Date.parse(event.ts));
      if (event.event === end && starts.has(key)) {
        phases[metric] += Date.parse(event.ts) - starts.get(key);
        starts.delete(key);
      }
    }
  }
  return {
    clock: "Server event wall-clock timestamps; diagnostic estimates only, not gate measurements",
    ...phases,
    checkpointCount: events.filter((event) => event.event === "timeline_checkpoint_persisted")
      .length,
  };
}

async function savePerformanceReport(testInfo, samples, gate) {
  const output = testInfo.outputPath("performance.json");
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        version: 1,
        scenario: PERF_SCENARIO,
        clock: "Playwright worker performance.now; transport observation includes browser delivery",
        exclusions: PERF_EXCLUSIONS,
        plugins: ["character"],
        samples,
        gate,
      },
      null,
      2,
    ),
  );
  return output;
}

test("@perf PBE-058 deterministic session performance across six turns", async ({
  noobot,
  protocolCapture,
  request,
}, testInfo) => {
  test.skip(process.env.NOOBOT_E2E_PERF !== "1", "Requires isolated mock-model Docker suite");
  test.setTimeout(DEVELOPMENT_THRESHOLDS.performance.testTimeoutMs);
  expect([...PERF_TOOLS, ...Object.keys(PERF_EXCLUSIONS)].sort()).toEqual(
    [...BUILTIN_TOOL_IDS].sort(),
  );
  const samples = [];
  let gate;
  const headers = { "x-api-key": noobot.connectConfig.apiKey };
  const connectorName = `e2e-perf-${Date.now()}-${testInfo.workerIndex}`;
  const response = await request.post(
    `/api/internal/connectors/${encodeURIComponent(noobot.userId)}`,
    {
      headers,
      data: {
        name: connectorName,
        instanceType: "builtin.database.sqlite",
        parameters: { file_path: "runtime/ops_workdir/perf.sqlite" },
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const connectorId = (await response.json()).connection.connector.connectorId;
  try {
    await sendMessage(noobot.page, uniquePrompt(testInfo, "Initialize performance session"));
    const initialization = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
    await waitForNaturalCompletion({
      page: noobot.page,
      capture: protocolCapture,
      sessionId: noobot.sessionId,
      turnScopeId: initialization.identity.turnScopeId,
    });
    await reloadAndWaitForReconnect(noobot.page, protocolCapture);
    await setMainSummaryTurnsThreshold(noobot.page, scenarioSteps("unused").length);
    await selectPlugins(noobot.page, ["character"]);
    await noobot.page.getByTestId("right-feature-panel-toggle").click();
    await noobot.page.getByTestId("character-load-sample").click();
    await expect(noobot.page.locator(".character-animation-assets__preview-title")).toContainText(
      "RobotExpressive.glb",
    );
    await noobot.page.locator(".composer-icon-btn").first().click();
    const connectorOption = noobot.page.locator(".connector-option", { hasText: connectorName });
    await expect(connectorOption).toBeVisible();
    await connectorOption.click();
    await noobot.page.locator(".more-collapse-btn").click();
    for (let round = 1; round <= DEVELOPMENT_THRESHOLDS.performance.rounds; round += 1) {
      samples.push(await runRound(noobot, protocolCapture, testInfo, round, connectorId));
      await savePerformanceReport(testInfo, samples, gate);
      console.log(
        `[perf] round=${round} tools=${samples.at(-1).toolCount} totalMs=${samples.at(-1).metrics.totalMs.toFixed(1)}`,
      );
    }
    const baseline = JSON.parse(
      await fs.readFile(
        new URL("../../../../../../scripts/e2e-docker/perf-baseline.json", import.meta.url),
        "utf8",
      ),
    );
    gate = evaluatePerformance(samples, baseline);
    expect(gate.failures, JSON.stringify(gate.metrics, null, 2)).toEqual([]);
  } finally {
    const output = await savePerformanceReport(testInfo, samples, gate);
    await testInfo.attach("performance.json", { path: output, contentType: "application/json" });
    const cleanup = await request.delete(
      `/api/internal/connectors/${encodeURIComponent(noobot.userId)}/${encodeURIComponent(connectorId)}`,
      { headers },
    );
    expect(cleanup.ok(), "delete isolated connector").toBe(true);
  }
});
