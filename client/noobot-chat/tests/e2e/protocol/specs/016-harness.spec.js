/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectPlugins,
  sendMessage,
  setHarnessCapability,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { assertCapabilityModelTraces, assertHarnessRun } from "../helpers/harness-assertions.js";
import { assertNoForbiddenErrors } from "../helpers/log-assertions.js";
import { readHarnessRun, readJsonLines, workspaceRoot } from "../helpers/persistence-audit.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import path from "node:path";

test("@core PBE-016 Harness 插件连接", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "harness simple request"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.preferences.selectedPlugins).toEqual(["harness"]);
  const processing = await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await waitForNaturalCompletion({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId, turnScopeId: send.identity.turnScopeId });
  const harness = await readHarnessRun(noobot.userId, processing.dialogProcessId);
  assertHarnessRun(harness.run, { dialogProcessId: processing.dialogProcessId, status: "success" });
  expect(harness.context).toBeTruthy();
  expect(harness.events.length).toBeGreaterThan(0);
});

test("@core PBE-017 Harness Hook 与 Model Context", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "use a tool and perform long analysis"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  const processing = await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
  const harness = await readHarnessRun(noobot.userId, processing.dialogProcessId);
  expect(harness.run.status).toBe("abort");
  expect(JSON.stringify(harness.context)).not.toMatch(/"bindings"\s*:/);
  assertNoForbiddenErrors(protocolCapture.console);
});

test("@core PBE-018 Harness 辅助模型连接", async ({ noobot, protocolCapture }, testInfo) => {
  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", true);
  await sendMessage(noobot.page, uniquePrompt(testInfo, "create a plan requiring separate planning guidance"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.preferences.pluginModelConfig.harness.capabilityProfile.planning.enabled).toBe(true);
  const processing = await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await waitForNaturalCompletion({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId, turnScopeId: send.identity.turnScopeId });
  const tracePath = path.join(workspaceRoot(), noobot.userId, "runtime/harness/runs", processing.dialogProcessId, "capability-traces.jsonl");
  const traces = await readJsonLines(tracePath);
  assertCapabilityModelTraces(traces);
});
