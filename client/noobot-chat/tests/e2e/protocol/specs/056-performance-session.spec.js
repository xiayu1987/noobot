/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { MODEL_CONTEXT_TRACE, summarizeModelPipelineTiming } from "@noobot/model-protocol";
import { summarizeProcessingTiming } from "@noobot/shared/processing-timing";
import { assertToolCallTimingInterval } from "@noobot/event-protocol/tool-timing";
import { readAuxiliaryModelRelayPurpose } from "@noobot/context-protocol/message/injected-types";
import { seedPerformanceHistory } from "../helpers/performance-history.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";
import { test as baseTest, expect } from "../fixtures/noobot.fixture.js";
import {
  sendMessage,
  waitForNaturalCompletion,
  setHarnessCapability,
  selectPlugins,
  stopActiveTurn,
} from "../helpers/browser-actions.js";
import {
  assertContinuation,
  assertTurnLifecycle,
  commandsForSession,
  settleSessionBeforeCleanup,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { findAgentCommands, findLifecycleEnvelopes } from "../helpers/websocket-capture.js";
import {
  iterateSessionExecutionEvents,
  modelInvocationTraces,
  waitForHarnessRun,
} from "../helpers/persistence-audit.js";
import {
  assertCanonicalToolPairs,
  toolEventsForTurn,
} from "../helpers/thinking-tool-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { runOpsWorkdirPath } from "../helpers/run-ops-workdir.js";
import { BUILTIN_TOOL_IDS } from "../../../../../../agent/src/tools/constants/index.js";
import { summarizeExecutionMetrics } from "../../../../../../agent/src/observability/execution-log/execution-report-metrics.js";
import {
  PERF_TOOLS,
  PERF_ALL_TOOLS,
  scenarioSteps,
} from "../../../../../../scripts/mock-model-service/scenario.mjs";
import {
  PERF_SCENARIO,
  PERF_ROUNDS,
  PERF_PLUGINS,
  PERF_HARNESS,
  PERF_STOP_CONTINUE_CYCLES,
  performanceRound,
} from "../../../../../../scripts/mock-model-service/performance-contract.mjs";
import {
  evaluatePerformance,
  evaluatePerformanceCollection,
  evaluateSingleRoundPerformance,
} from "../../../../../../scripts/e2e-docker/performance-gate.mjs";
import { assertHarnessRun, assertCapabilityModelTraces } from "../helpers/harness-assertions.js";
import { assertPerformanceHarness } from "../../../../../../scripts/e2e-docker/performance-harness.mjs";
import { DEVELOPMENT_THRESHOLDS } from "../../../../../../scripts/lib/development-thresholds.mjs";
import {
  installPerformanceInputTiming,
  readPerformanceInputTiming,
} from "../helpers/performance-input-timing.js";

const test = baseTest.extend({
  performanceConnector: async ({ noobot, protocolCapture, playwright, baseURL }, use, testInfo) => {
    if (process.env.NOOBOT_E2E_PERF !== "1") {
      await use(null);
      return;
    }
    const request = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-api-key": noobot.connectConfig.apiKey },
    });
    const endpoint = `/api/internal/connectors/${encodeURIComponent(noobot.userId)}`;
    const connectorName = `e2e-perf-${Date.now()}-${testInfo.workerIndex}`;
    try {
      const response = await request.post(endpoint, {
        data: {
          name: connectorName,
          instanceType: "builtin.database.sqlite",
          parameters: { file_path: "runtime/ops_workdir/perf.sqlite" },
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
      const connectorId = (await response.json()).connection.connector.connectorId;
      try {
        await use({ connectorName, connectorId });
      } finally {
        await settleSessionBeforeCleanup(protocolCapture, noobot.sessionId, () =>
          stopActiveTurn(noobot.page),
        );
        const cleanup = await request.delete(`${endpoint}/${encodeURIComponent(connectorId)}`);
        expect(cleanup.ok(), "delete isolated connector").toBe(true);
      }
    } finally {
      await request.dispose();
    }
  },
});

function lifecycleTime(capture, turnScopeId, eventType) {
  const frame = capture.websocketReceived.find((record) =>
    findLifecycleEnvelopes([record]).some(
      (event) => event.turnScopeId === turnScopeId && event.eventType === eventType,
    ),
  );
  expect(frame, `missing ${eventType}`).toBeTruthy();
  return frame.atMs;
}

async function runRound(noobot, capture, testInfo, round, connectorId, previous = null) {
  const { repetitions, kind } = performanceRound(round);
  const before = commandsForSession(capture, noobot.sessionId).length;
  const filePath = runOpsWorkdirPath(`perf-${round}.txt`);
  await noobot.page
    .locator(".chat-input textarea")
    .fill(
      uniquePrompt(
        testInfo,
        `NOOBOT_PERF_CASE:${filePath} NOOBOT_PERF_ROUND:${round} NOOBOT_PERF_CONNECTOR:${connectorId}`,
      ),
    );
  const clickAtMs = performance.now();
  await noobot.page.locator(".send-btn").click();
  const command = await waitForCommand(
    capture,
    noobot.sessionId,
    previous ? "turn.continue" : "turn.send",
    before,
  );
  if (previous) assertContinuation(previous, command);
  const sent = capture.websocketSent.find((record) =>
    findAgentCommands([record]).some((item) => item.commandId === command.commandId),
  );
  const turnScopeId = command.identity.turnScopeId;
  for (let index = 0; index < repetitions; index += 1) {
    const interaction = noobot.page
      .locator(".interaction-card")
      .filter({ has: noobot.page.locator(".el-input input:enabled") });
    await interaction.waitFor({
      state: "visible",
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
  const processing = await waitForLifecycle(
    capture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    turnScopeId,
  );
  const records = [];
  const mainRequests = [];
  for await (const record of iterateSessionExecutionEvents(noobot.userId, noobot.sessionId, {
    dialogProcessId: processing.dialogProcessId,
  })) {
    if (record.turnScopeId !== turnScopeId && record.turnScopeId !== previous?.identity.turnScopeId)
      continue;
    if (modelInvocationTraces([record]).length && record.turnScopeId === turnScopeId) {
      mainRequests.push({
        data: {
          invocation: record.data.invocation,
          attempt: record.data.attempt,
          relays: [
            ...new Set(
              record.data.messages.evidence
                .map((message) => readAuxiliaryModelRelayPurpose(message.injectedMessageType))
                .filter(Boolean),
            ),
          ],
        },
      });
    }
    if (record.event !== MODEL_CONTEXT_TRACE.EVENT) records.push(record);
  }
  if (previous) {
    for await (const record of iterateSessionExecutionEvents(noobot.userId, noobot.sessionId, {
      dialogProcessId: previous.identity.dialogProcessId,
    })) {
      if (
        record.turnScopeId === previous.identity.turnScopeId &&
        record.event !== MODEL_CONTEXT_TRACE.EVENT
      )
        records.push(record);
    }
  }
  const events = toolEventsForTurn(records, turnScopeId);
  const steps = scenarioSteps(filePath, connectorId);
  const stoppedResults = previous
    ? toolEventsForTurn(records, previous.identity.turnScopeId).filter(
        (event) => event.event === "tool_call_end" && event.data.success,
      )
    : [];
  if (previous)
    expect(stoppedResults.length).toBe(steps.findIndex((step) => step.name === "user_interaction"));
  const expected = Array.from({ length: repetitions }, () => steps)
    .flat()
    .map((step) => step.name);
  const { calls, results } = assertCanonicalToolPairs(events, expected);
  expect(calls.map((event) => event.data.tool)).toEqual(expected);
  for (const result of results) expect(result.data.success, result.data.result).toBe(true);
  const primaryRequests = mainRequests.filter(
    (trace) => trace.data.invocation?.flow === "agent.main",
  );
  expect(primaryRequests.length).toBeGreaterThanOrEqual(expected.length + 1);
  const purposes = new Set(
    mainRequests
      .filter((trace) => trace.data.invocation?.flow !== "agent.main")
      .map((trace) => trace.data.invocation?.purpose),
  );
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
    acceptedMs: lifecycleTime(capture, turnScopeId, "turn.action_accepted") - clickAtMs,
    processingMs: lifecycleTime(capture, turnScopeId, "turn.processing_started") - clickAtMs,
    uiReadyMs: Math.max(0, uiAtMs - terminal),
  };
  const toolSamples = Object.fromEntries(
    PERF_ALL_TOOLS.map((name) => [
      name,
      results.filter((result) => result.data.tool === name).map((result) => result.data.durationMs),
    ]),
  );
  for (const [name, values] of Object.entries(toolSamples)) {
    expect(values, `${name} repetitions`).toHaveLength(repetitions);
  }
  const scoped = records.filter((event) => event.turnScopeId === turnScopeId);
  const diagnostics = summarizeModelPipelineTiming(scoped);
  const toolTimings = scoped
    .filter(({ event }) => event === "tool_call_timing")
    .map(({ data }) => assertToolCallTimingInterval(data));
  expect(toolTimings).toHaveLength(expected.length);
  expect(new Set(toolTimings.map(({ toolCallId }) => toolCallId)).size).toBe(expected.length);
  const processingTiming = summarizeProcessingTiming({
    scope: {
      clockId: diagnostics.clockId,
      startMs: Math.min(
        diagnostics.startMs,
        ...toolTimings.map(({ interval }) => interval.startMs),
      ),
      endMs: Math.max(diagnostics.endMs, ...toolTimings.map(({ interval }) => interval.endMs)),
    },
    modelIntervals: diagnostics.transportIntervals,
    toolIntervals: toolTimings.flatMap(({ interval }) =>
      interval.execution === null
        ? []
        : [
            {
              clockId: interval.clockId,
              ...interval.execution,
            },
          ],
    ),
  });
  expect(toolTimings.every(({ interval }) => interval.clockId === diagnostics.clockId)).toBe(true);
  metrics.pipelineLocalMs = diagnostics.localMs;
  const executionReport = summarizeExecutionMetrics(scoped);
  expect(
    executionReport.tools.splitTimedCount,
    "every tool must have execution/framework timing",
  ).toBe(expected.length);
  const checkpoints = scoped.filter((event) => event.event === "timeline_checkpoint_persisted");
  expect(checkpoints.length).toBeGreaterThanOrEqual(expected.length * 3 + 1);
  metrics.checkpointMs =
    checkpoints.reduce((sum, event) => sum + event.data.durationMs, 0) / checkpoints.length;
  expect(
    scoped.filter((event) => event.event === "summary_checkpoint_committed").length,
  ).toBeGreaterThan(0);
  const harness = await waitForHarnessRun(
    noobot.userId,
    processing.dialogProcessId,
    (candidate) => candidate.run?.status === "success",
  );
  assertHarnessRun(harness.run, { dialogProcessId: processing.dialogProcessId, status: "success" });
  assertCapabilityModelTraces(harness.capabilityTraces);
  const harnessEvidence = {
    run: harness.run,
    purposes: [...purposes],
    mainRelays: [...new Set(primaryRequests.flatMap((trace) => trace.data.relays))],
    events: harness.events
      .flatMap((record) => record.capabilityLogs || [])
      .map(({ event, detail }) => ({
        event,
        detail:
          detail &&
          Object.fromEntries(
            [
              "error",
              "errorCode",
              "thresholdMode",
              "thresholdSource",
              "triggerTurns",
              "modelAttempts",
            ]
              .filter((key) => Object.hasOwn(detail, key))
              .map((key) => [key, detail[key]]),
          ),
      })),
  };
  assertPerformanceHarness(harnessEvidence);
  return {
    round,
    kind,
    repetitions,
    harness: harnessEvidence,
    turnScopeId,
    inputTiming: {
      clickAtMs,
      commandSentAtMs: sent.atMs,
      clickToCommandMs: sent.atMs - clickAtMs,
      clickToVisibleCompletionMs: uiAtMs - clickAtMs,
      clickToTerminalMs: terminal - clickAtMs,
      firstToolMs: firstTool.atMs - clickAtMs,
      browser: await readPerformanceInputTiming(noobot.page, command.commandId),
    },
    metrics,
    diagnostics,
    processingTiming,
    checkpointSamples: checkpoints.map(({ data }) => ({
      storageWork: data.storageWork,
      durationMs: data.durationMs,
      preparationMs: data.preparationMs,
      appendMs: data.appendMs,
      verificationMs: data.verificationMs,
      queueWaitMs: data.queueWaitMs,
      messageCount: data.messageCount,
      persistedMessageCount: data.persistedMessageCount,
    })),
    executionReport,
    toolSamples,
    modelRequestCount: primaryRequests.length,
    auxiliaryModelRequestCount: mainRequests.length - primaryRequests.length,
    summaryCount: scoped.filter((event) => event.event === "summary_checkpoint_committed").length,
    toolCount: results.length,
    serverToolEvents: events.map(({ event, data }) => ({
      event,
      data: {
        tool: data.tool,
        success: data.success,
        toolCallId: data.toolCallId,
        durationMs: data.durationMs,
      },
    })),
  };
}

async function runStopContinue(noobot, capture, testInfo, cycle, connectorId) {
  const before = commandsForSession(capture, noobot.sessionId).length;
  const filePath = runOpsWorkdirPath(`perf-stop-${cycle}.txt`);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `NOOBOT_PERF_CASE:${filePath} NOOBOT_PERF_ROUND:${PERF_ROUNDS.length + cycle} NOOBOT_PERF_CONNECTOR:${connectorId}`,
    ),
  );
  const send = await waitForCommand(capture, noobot.sessionId, "turn.send", before);
  const processing = await waitForLifecycle(
    capture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    send.identity.turnScopeId,
  );
  const interaction = noobot.page
    .locator(".interaction-card")
    .filter({ has: noobot.page.locator(".el-input input:enabled") });
  await interaction.waitFor({ state: "visible" });
  const stopClickAtMs = performance.now();
  await noobot.page.locator(".stop-float-btn").click();
  await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();
  const stoppedUiAtMs = performance.now();
  const continued = await runRound(
    noobot,
    capture,
    testInfo,
    PERF_ROUNDS.length + cycle,
    connectorId,
    { ...send, identity: { ...send.identity, dialogProcessId: processing.dialogProcessId } },
  );
  const stop = await waitForCommand(capture, noobot.sessionId, "turn.stop", before);
  const stopFrame = capture.websocketSent.find((record) =>
    findAgentCommands([record]).some((item) => item.commandId === stop.commandId),
  );
  await assertTurnLifecycle(capture, noobot.sessionId, send.identity.turnScopeId);
  const stopCompletedAtMs = lifecycleTime(
    capture,
    send.identity.turnScopeId,
    "turn.stop_completed",
  );
  return {
    cycle,
    stoppedTurnScopeId: send.identity.turnScopeId,
    stopTiming: {
      clickToCommandMs: stopFrame.atMs - stopClickAtMs,
      clickToCompletedMs: stopCompletedAtMs - stopClickAtMs,
      clickToUiReadyMs: stoppedUiAtMs - stopClickAtMs,
      browser: await readPerformanceInputTiming(noobot.page, stop.commandId),
    },
    continued,
  };
}

async function savePerformanceReport(testInfo, { samples, gate, stopContinues, history, timing }) {
  const output = testInfo.outputPath("performance.json");
  await fs.writeFile(
    output,
    JSON.stringify(
      {
        version: 2,
        mode: process.env.NOOBOT_E2E_PERF_MODE || "verify",
        scope: testInfo.project.metadata.performanceMode,
        scenario: PERF_SCENARIO,
        clock:
          "Playwright worker performance.now; timing includes session initialization, history preparation, UI configuration, replay and evidence verification; inputTiming starts before real locator.click and excludes text entry; fixture setup is additionally bounded by the Playwright test timeout",
        plugins: PERF_PLUGINS,
        plan:
          testInfo.project.metadata.performanceMode === "single"
            ? PERF_ROUNDS.slice(0, 1)
            : PERF_ROUNDS,
        harness: PERF_HARNESS,
        samples,
        stopContinues,
        history,
        timing,
        gate,
      },
      null,
      2,
    ),
  );
  return output;
}

test("@perf PBE-058 Harness performance session", async ({
  noobot,
  protocolCapture,
  protocolArtifacts,
  performanceConnector,
}, testInfo) => {
  test.skip(process.env.NOOBOT_E2E_PERF !== "1", "Requires isolated mock-model Docker suite");
  const startedAtMs = performance.now();
  const timing = {};
  const mode = process.env.NOOBOT_E2E_PERF_MODE || "verify";
  expect(["collect", "verify"]).toContain(mode);
  const scope = testInfo.project.metadata.performanceMode;
  expect(["single", "multi"]).toContain(scope);
  const single = scope === "single";
  test.setTimeout(
    single ? PROTOCOL_TIMEOUTS.model : DEVELOPMENT_THRESHOLDS.performance.testTimeoutMs,
  );
  expect([...PERF_TOOLS].sort()).toEqual([...BUILTIN_TOOL_IDS].sort());
  const samples = [];
  const stopContinues = [];
  let gate;
  let history;
  const { connectorName, connectorId } = performanceConnector;
  try {
    await sendMessage(noobot.page, uniquePrompt(testInfo, "Initialize performance session"));
    const initialization = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
    await waitForNaturalCompletion({
      page: noobot.page,
      capture: protocolCapture,
      sessionId: noobot.sessionId,
      turnScopeId: initialization.identity.turnScopeId,
    });
    history = await test.step("Prepare and verify performance history", () =>
      seedPerformanceHistory(noobot));
    await reloadAndWaitForReconnect(noobot.page, protocolCapture);
    await installPerformanceInputTiming(noobot.page);
    await selectPlugins(noobot.page, PERF_PLUGINS);
    await setHarnessCapability(noobot.page, "Planning", true);
    await setHarnessCapability(noobot.page, "Planning Acceptance", true);
    await noobot.page.getByTestId("right-feature-panel-toggle").click();
    await noobot.page.getByTestId("character-load-sample").click();
    await expect(noobot.page.locator(".character-animation-assets__preview-title")).toContainText(
      "RobotExpressive.glb",
    );
    await noobot.page.locator(".composer-icon-btn").first().click();
    const connectorOption = noobot.page.locator(".connector-option", {
      hasText: connectorName,
    });
    await expect(connectorOption).toBeVisible();
    await connectorOption.click();
    await noobot.page.locator(".more-collapse-btn").click();
    timing.preparationMs = performance.now() - startedAtMs;
    for (const { round } of single ? PERF_ROUNDS.slice(0, 1) : PERF_ROUNDS) {
      samples.push(await runRound(noobot, protocolCapture, testInfo, round, connectorId));
      timing.totalMs = performance.now() - startedAtMs;
      await savePerformanceReport(testInfo, { samples, gate, stopContinues, history, timing });
      console.log(
        `[perf] round=${round} tools=${samples.at(-1).toolCount} localMs=${samples.at(-1).metrics.pipelineLocalMs.toFixed(1)} heapMB=${(process.memoryUsage().heapUsed / 1048576).toFixed(1)}`,
      );
      await protocolArtifacts.flush();
    }
    if (single) {
      timing.totalMs = performance.now() - startedAtMs;
      gate = evaluateSingleRoundPerformance(samples, timing);
      expect(gate.failures, JSON.stringify(gate.metrics, null, 2)).toEqual([]);
      return;
    }
    for (let cycle = 1; cycle <= PERF_STOP_CONTINUE_CYCLES; cycle += 1) {
      stopContinues.push(
        await runStopContinue(noobot, protocolCapture, testInfo, cycle, connectorId),
      );
      timing.totalMs = performance.now() - startedAtMs;
      await savePerformanceReport(testInfo, { samples, gate, stopContinues, history, timing });
      console.log(
        `[perf] stop-continue=${cycle} stopMs=${stopContinues.at(-1).stopTiming.clickToUiReadyMs.toFixed(1)} localMs=${stopContinues.at(-1).continued.metrics.pipelineLocalMs.toFixed(1)}`,
      );
      await protocolArtifacts.flush();
    }
    const continuations = stopContinues.map(({ continued }) => continued);
    if (mode === "collect") {
      gate = evaluatePerformanceCollection(samples, continuations, stopContinues);
    } else {
      const baseline = JSON.parse(
        await fs.readFile(
          new URL("../../../../../../scripts/e2e-docker/perf-baseline.json", import.meta.url),
          "utf8",
        ),
      );
      gate = evaluatePerformance(samples, baseline, continuations, stopContinues);
    }
    await reloadAndWaitForReconnect(noobot.page, protocolCapture);
    await expect(
      noobot.page.getByRole("paragraph").filter({ hasText: "NOOBOT-PERF-DONE:" }).first(),
    ).toBeVisible();
    expect(gate.failures, JSON.stringify(gate.metrics, null, 2)).toEqual([]);
  } finally {
    if (!gate) timing.totalMs = performance.now() - startedAtMs;
    const output = await savePerformanceReport(testInfo, {
      samples,
      gate,
      stopContinues,
      history,
      timing,
    });
    await testInfo.attach("performance.json", {
      path: output,
      contentType: "application/json",
    });
  }
});
