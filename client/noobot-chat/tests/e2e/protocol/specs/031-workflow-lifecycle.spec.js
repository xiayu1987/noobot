/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectPlugins,
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  assertRootModelInvocation,
  assertWorkflowChildModelInvocation,
  isMainAgentModelInvocation,
} from "../helpers/model-message-assertions.js";
import {
  waitForModelInvocationTraces,
  waitForSessionExecutionEventTree,
} from "../helpers/persistence-audit.js";
import {
  assertContinuation,
  assertTurnLifecycle,
  commandsForSession,
  lifecycleForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

async function assertCompletedWorkflowChildPresentation(page) {
  const actionNode = page.locator(".workflow-node:not(.is-state-node)").last();
  await expect(actionNode).toBeVisible();
  await actionNode.click();

  const runtimeStep = page.locator(".workflow-node-session-drawer .workflow-runtime-step-box:not(:disabled)").last();
  await expect(runtimeStep).toBeVisible();
  await runtimeStep.click();

  const executionView = page.locator(".workflow-node-session-drawer .agent-execution-view");
  await expect(executionView).toBeVisible();
  const statusSteps = executionView.locator(".message-status-steps");
  await expect(statusSteps).not.toHaveCount(0);
  await expect(executionView.locator(".message-status-steps.is-running")).toHaveCount(0);
  await expect(statusSteps.last()).toHaveClass(/is-success/);
  const thinkingElapsed = executionView.locator(".thinking-elapsed").last();
  await expect(thinkingElapsed).toBeVisible();
  await expect(thinkingElapsed).not.toContainText("--:--");
}

test("@full PBE-031 Workflow 运行中停止并继续", async ({ noobot, protocolCapture }, testInfo) => {
  const workflowCompletionTimeoutMs = 360000;
  test.setTimeout(workflowCompletionTimeoutMs + 180000);
  await selectPlugins(noobot.page, ["workflow", "harness"]);
  const beforeSend = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "build exactly three sequential workflow child tasks named calc1, calc2, calc3.",
        "Each child must call execute_script exactly once for a concrete arithmetic calculation.",
        "Use these calculations in order: calc1=11+7, calc2=6*8, calc3=144/12.",
        "Do not merge tasks, do not answer directly, and start executing the workflow immediately.",
      ].join(" "),
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", beforeSend);
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    send.identity.turnScopeId,
  );
  const authoritativeSend = {
    ...send,
    identity: { ...send.identity, dialogProcessId: processing.dialogProcessId },
  };
  const initialTraces = await waitForModelInvocationTraces(
    noobot.userId,
    noobot.sessionId,
    (traces) => traces.some((record) => record.parentSessionId === noobot.sessionId),
  );
  assertWorkflowChildModelInvocation(
    initialTraces.find((record) => record.parentSessionId === noobot.sessionId),
    noobot.sessionId,
  );

  await stopActiveTurn(noobot.page);
  const stop = await waitForCommand(protocolCapture, noobot.sessionId, "turn.stop", beforeSend);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    send.identity.turnScopeId,
  );
  expect(stop.identity).toMatchObject(authoritativeSend.identity);
  assertTurnLifecycle(protocolCapture, noobot.sessionId, send.identity.turnScopeId);
  const stoppedExecutionEvents = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      records.some(
        (record) =>
          record.event === "detached_sub_session_stop_committed" &&
          record.parentSessionId === noobot.sessionId &&
          record.data?.reason === "user_stop" &&
          record.data?.state === "stop_completed",
      ),
  );
  expect(
    stoppedExecutionEvents.some(
      (record) => record.event === "detached_sub_session_failure_committed",
    ),
  ).toBe(false);

  const beforeContinue = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(
    noobot.page,
    uniquePrompt(testInfo, "continue the stopped workflow to completion"),
  );
  const continued = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.continue",
    beforeContinue,
  );
  assertContinuation(authoritativeSend, continued);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    continued.identity.turnScopeId,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: continued.identity.turnScopeId,
    timeoutMs: workflowCompletionTimeoutMs,
  });
  assertTurnLifecycle(protocolCapture, noobot.sessionId, continued.identity.turnScopeId);
  const continuedTraces = await waitForModelInvocationTraces(
    noobot.userId,
    noobot.sessionId,
    (traces) =>
      traces.some((record) => record.turnScopeId === continued.identity.turnScopeId) ||
      traces.some(
        (record) =>
          record.parentSessionId === noobot.sessionId &&
          !initialTraces.some((initial) => initial.dialogProcessId === record.dialogProcessId),
      ),
  );
  continuedTraces.forEach((trace) => {
    if (!isMainAgentModelInvocation(trace)) return;
    if (trace.sessionId === noobot.sessionId) {
      assertRootModelInvocation(trace, noobot.sessionId, trace.turnScopeId);
    } else {
      assertWorkflowChildModelInvocation(trace, noobot.sessionId);
    }
  });
});

test("@full PBE-032 Workflow 完成后普通消息再切回 Workflow", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  const runToCompletion = async (pluginKeys, purpose) => {
    await selectPlugins(noobot.page, pluginKeys);
    const before = commandsForSession(protocolCapture, noobot.sessionId).length;
    await sendMessage(noobot.page, uniquePrompt(testInfo, purpose));
    const command = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", before);
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.processing_started",
      0,
      command.identity.turnScopeId,
    );
    await waitForNaturalCompletion({
      page: noobot.page,
      capture: protocolCapture,
      sessionId: noobot.sessionId,
      turnScopeId: command.identity.turnScopeId,
      timeoutMs: 300000,
    });
    assertTurnLifecycle(protocolCapture, noobot.sessionId, command.identity.turnScopeId);
    if (pluginKeys.includes("workflow")) {
      const events = lifecycleForSession(protocolCapture, noobot.sessionId).filter(
        (event) => event.turnScopeId === command.identity.turnScopeId,
      );
      expect(events.some((event) => event.executionId)).toBe(true);
      await assertCompletedWorkflowChildPresentation(noobot.page);
      const visibleCloseButton = noobot.page.locator(
        ".workflow-node-session-drawer .el-drawer__close-btn:visible",
      );
      await visibleCloseButton.last().click();
    }
    return command;
  };

  const firstWorkflow = await runToCompletion(
    ["workflow", "harness"],
    "execute one child task that uses execute_script once to calculate 21 * 2",
  );
  const ordinary = await runToCompletion([], "answer directly without creating a workflow");
  const secondWorkflow = await runToCompletion(
    ["workflow", "harness"],
    "execute a second child task that uses execute_script once to calculate 6 * 7",
  );

  expect(new Set(firstWorkflow.preferences.selectedPlugins)).toEqual(
    new Set(["workflow", "harness"]),
  );
  expect(ordinary.preferences.selectedPlugins).toEqual([]);
  expect(new Set(secondWorkflow.preferences.selectedPlugins)).toEqual(
    new Set(["workflow", "harness"]),
  );
  expect(
    new Set([
      firstWorkflow.identity.turnScopeId,
      ordinary.identity.turnScopeId,
      secondWorkflow.identity.turnScopeId,
    ]).size,
  ).toBe(3);

  const traces = await waitForModelInvocationTraces(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      records.some((record) => record.turnScopeId === ordinary.identity.turnScopeId) &&
      new Set(
        records
          .filter((record) => record.parentSessionId === noobot.sessionId)
          .map((record) => record.dialogProcessId),
      ).size >= 2,
  );
  const ordinaryTrace = traces.find(
    (record) =>
      record.turnScopeId === ordinary.identity.turnScopeId && isMainAgentModelInvocation(record),
  );
  assertRootModelInvocation(ordinaryTrace, noobot.sessionId, ordinary.identity.turnScopeId);
  const workflowChildTraces = traces.filter(
    (record) => record.parentSessionId === noobot.sessionId && isMainAgentModelInvocation(record),
  );
  expect(
    new Set(workflowChildTraces.map((record) => record.dialogProcessId)).size,
  ).toBeGreaterThanOrEqual(2);
  workflowChildTraces.forEach((record) =>
    assertWorkflowChildModelInvocation(record, noobot.sessionId),
  );
});
