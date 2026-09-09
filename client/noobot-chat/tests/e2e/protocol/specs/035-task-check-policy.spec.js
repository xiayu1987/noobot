/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { parseTaskCheckContent } from "@noobot/context-protocol/task/check";
import { resolveContextInternalMessageType } from "@noobot/context-protocol/policy/injected-message";
import {
  selectPlugins,
  sendMessage,
  setHarnessCapability,
  setHarnessRuntimeThresholds,
  setRunSummaryPolicy,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  modelInvocationTraces,
  readSessionExecutionEventTree,
  readSessionTurnMessages,
  waitForHarnessRun,
  waitForSessionExecutionEventTree,
} from "../helpers/persistence-audit.js";
import { isMainAgentModelInvocation } from "../helpers/model-message-assertions.js";
import {
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

const toolCallName = (call = {}) => String(call.name || call.function?.name || "").trim();
const toolCallId = (call = {}) => String(call.id || call.tool_call_id || "").trim();
const toolCallArgs = (call = {}) =>
  call.args && typeof call.args === "object"
    ? call.args
    : JSON.parse(String(call.function?.arguments || "{}"));

function toolResultPayload(message = {}) {
  if (message.role !== "tool") return null;
  const payload = JSON.parse(String(message.content || "{}"));
  return payload && typeof payload === "object" ? payload : null;
}

function taskCheckCalls(messages = []) {
  return messages.flatMap((message, messageIndex) =>
    (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((call) => toolCallName(call) === "task_check")
      .map((call) => ({ call, message, messageIndex })),
  );
}

function harnessCapabilityEvents(records = []) {
  return records.flatMap((record) =>
    Array.isArray(record?.capabilityLogs) ? record.capabilityLogs : [],
  );
}

function assertCompactExecutionContext(invocations = []) {
  expect(invocations.length).toBeGreaterThan(0);
  for (const invocation of invocations) {
    const executionContext = invocation.data.messages.preview.find((message) =>
      String(message.contentPreview || "").startsWith("# Current execution context"),
    );
    expect(executionContext).toBeTruthy();
    expect(executionContext.contentLength).toBeGreaterThan(0);
    expect(executionContext.contentLength).toBeLessThan(256);
    for (const forbidden of [
      "sessionId",
      "parentSessionId",
      "rootSessionId",
      "sessionTree",
      "safeConfirm",
      "safeConfirmLevel",
    ]) {
      expect(executionContext.contentPreview).not.toContain(forbidden);
    }
  }
}

test("@full PBE-035 task_check 周期切片、checkpoint 保留与 history 模型输入闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, []);
  await setRunSummaryPolicy(noobot.page, {
    phaseSummaryLoopTurns: 3,
    taskCheckLoopTurns: 2,
  });
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "完成一个三步顺序只读计算链，每一步都必须等待上一步的实际输出。",
        "依次调用 execute_script：生成随机十六进制 token、计算其 SHA-256、计算该 SHA-256 的字符数。",
        "第二次 execute_script 成功后，下一次只能调用 task_check，按协议记录当时的真实任务状态；task_check 成功前不得执行第三次 execute_script。",
        "不得并行调用，最后汇总每一步实际结果。",
      ].join(" "),
    ),
  );

  const firstSend = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(firstSend.preferences.summaryPolicy).toEqual({
    phaseSummaryLoopTurns: 3,
    taskCheckLoopTurns: 2,
  });
  expect(firstSend.preferences.frontendThresholdsEnabled).toBe(true);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: firstSend.identity.turnScopeId,
    timeoutMs: 260000,
  });
  await expect(
    noobot.page.locator(".chat-message-anchor").filter({
      hasText: "已达到周期任务检查阈值",
    }),
  ).toHaveCount(0);

  const records = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (items) => {
      const scoped = items.filter((item) => item.turnScopeId === firstSend.identity.turnScopeId);
      return (
        scoped.some((item) => item.event === "task_check_required") &&
        scoped.some((item) => item.event === "summary_checkpoint_committed") &&
        modelInvocationTraces(scoped).filter(isMainAgentModelInvocation).length >= 4
      );
    },
  );
  const firstScoped = records.filter((item) => item.turnScopeId === firstSend.identity.turnScopeId);
  const taskCheckRequired = firstScoped.filter((item) => item.event === "task_check_required");
  expect(taskCheckRequired.length).toBeGreaterThan(0);
  for (const event of taskCheckRequired) {
    expect(event.data).toMatchObject({ threshold: 2 });
    expect(event.data.loopCount).toBeGreaterThan(0);
    expect(event.data.loopCount).toBeLessThanOrEqual(event.data.threshold);
  }

  const firstInvocations = modelInvocationTraces(firstScoped).filter(isMainAgentModelInvocation);
  assertCompactExecutionContext(firstInvocations);
  const markerCounts = firstInvocations.map(
    (invocation) =>
      invocation.data.messages.preview.filter(
        (message) => message.internalType === "noobot.task_check_prompt",
      ).length,
  );
  expect(markerCounts.some((count) => count > 0)).toBe(true);

  const firstMessages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  const taskCheckPrompts = firstMessages.filter(
    (message) => resolveContextInternalMessageType(message) === "noobot.task_check_prompt",
  );
  expect(taskCheckPrompts).toHaveLength(taskCheckRequired.length);
  expect(
    taskCheckPrompts.every(
      (message) => message.role === "user" && message.type === "context_control",
    ),
  ).toBe(true);
  const checks = taskCheckCalls(firstMessages);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.length).toBeLessThanOrEqual(taskCheckRequired.length);
  for (const { call } of checks) {
    expect(parseTaskCheckContent(toolCallArgs(call).checkContent).protocolVersion).toBe(1);
  }
  const checkResults = firstMessages.filter(
    (message) => toolResultPayload(message)?.toolName === "task_check",
  );
  expect(checkResults).toHaveLength(checks.length);
  for (const resultMessage of checkResults) {
    const payload = toolResultPayload(resultMessage);
    const call = checks.find(
      ({ call: candidate }) => toolCallId(candidate) === resultMessage.tool_call_id,
    )?.call;
    const parsed = parseTaskCheckContent(toolCallArgs(call).checkContent);
    expect(payload.protocolVersion).toBe(1);
    expect(payload.summary).toMatchObject({
      state: parsed.state,
      abstract: parsed.abstract,
      nextAction: parsed.nextAction,
    });
    expect(payload.summary.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.keys(payload.summary).sort()).toEqual([
      "abstract",
      "contentHash",
      "nextAction",
      "state",
    ]);
    expect(payload.summary.details).toBeUndefined();
    expect(resultMessage.transferEnvelopes || []).toEqual([]);
  }

  const summaryCallIndex = firstMessages.findLastIndex((message) =>
    (message.tool_calls || []).some((call) => toolCallName(call) === "task_summary"),
  );
  expect(summaryCallIndex).toBeGreaterThan(0);
  const latestCheckBeforeSummary = [...checks]
    .reverse()
    .find(({ messageIndex }) => messageIndex < summaryCallIndex);
  expect(latestCheckBeforeSummary).toBeTruthy();
  const latestCheckBeforeSummaryCallId = toolCallId(latestCheckBeforeSummary.call);
  const latestCheckBeforeSummaryResult = firstMessages.find(
    (message) =>
      message.role === "tool" &&
      String(message.tool_call_id || "").trim() === latestCheckBeforeSummaryCallId,
  );
  expect(latestCheckBeforeSummaryResult).toBeTruthy();
  const checkpointEvents = firstScoped.filter(
    (item) => item.event === "summary_checkpoint_committed",
  );
  const checkpointEvent = checkpointEvents.at(-1);
  expect(checkpointEvent).toBeTruthy();
  const preservedCheckpointEvidenceMessageUids =
    checkpointEvent.data?.preservedCheckpointEvidenceMessageUids || [];
  expect(preservedCheckpointEvidenceMessageUids).toHaveLength(2);
  const preservedCheck = checks.find(({ message, call }) => {
    const result = firstMessages.find(
      (candidate) =>
        candidate.role === "tool" &&
        String(candidate.tool_call_id || "").trim() === toolCallId(call),
    );
    return (
      preservedCheckpointEvidenceMessageUids.includes(message.messageUid) &&
      preservedCheckpointEvidenceMessageUids.includes(result?.messageUid)
    );
  });
  expect(preservedCheck).toBeTruthy();
  const preservedCheckResult = firstMessages.find(
    (message) =>
      message.role === "tool" &&
      String(message.tool_call_id || "").trim() === toolCallId(preservedCheck.call),
  );
  expect(preservedCheckResult).toBeTruthy();
  const postCheckpointInvocations = firstInvocations.filter(
    (invocation) => Number(invocation.data?.context?.summaryCheckpointRevision) >= 1,
  );
  expect(postCheckpointInvocations.length).toBeGreaterThan(0);
  for (const messageUid of preservedCheckpointEvidenceMessageUids) {
    expect(
      postCheckpointInvocations.some((invocation) =>
        invocation.data.messages.evidence.some((message) => message.messageId === messageUid),
      ),
    ).toBe(true);
  }
  const summarizedTaskCheckPrompts = taskCheckPrompts.filter(
    (message) => message.summarized === true,
  );
  expect(summarizedTaskCheckPrompts.length).toBeGreaterThan(0);

  const latestCheck = checks.at(-1);
  const latestCheckCallId = toolCallId(latestCheck.call);
  const latestCheckResult = firstMessages.find(
    (message) =>
      message.role === "tool" && String(message.tool_call_id || "").trim() === latestCheckCallId,
  );
  expect(latestCheckResult).toBeTruthy();
  const latestCheckAbstract = toolResultPayload(latestCheckResult).summary.abstract;
  const thinkingShell = noobot.page.locator(".base-thinking-collapse").last();
  await expect(thinkingShell).toBeVisible();
  await thinkingShell.locator(".el-collapse-item__header").click();
  await expect(
    noobot.page.locator('[data-thinking-block="task-check"]').filter({
      hasText: latestCheckAbstract,
    }),
  ).toHaveCount(1);

  const thinkingDetailsAction = thinkingShell.locator(".thinking-detail-action-button");
  await thinkingDetailsAction.click();
  const thinkingDetailsPanel = noobot.page.locator(".thinking-details-panel");
  await expect(thinkingDetailsPanel).toBeVisible();
  await thinkingDetailsPanel.locator(".el-tabs__item").nth(1).click();
  const taskCheckBlocks = thinkingDetailsPanel.locator('[data-thinking-block="task-check"]');
  await expect(taskCheckBlocks).toHaveCount(1);
  const taskCheckItems = taskCheckBlocks.locator(".thinking-task-check-item");
  await expect(taskCheckItems).toHaveCount(checkResults.length);
  expect(checkResults).toHaveLength(checks.length);
  for (let index = 0; index < checkResults.length; index += 1) {
    const result = checkResults[index];
    const expectedAbstract = toolResultPayload(result).summary.abstract;
    const item = taskCheckItems.nth(index);
    await expect(item.locator(".base-note-block__title")).toContainText(`${index + 1}.`);
    await expect(item.locator(".base-note-block__title")).toContainText(/ · \d{4}-\d{2}-\d{2}T/);
    await expect(item.locator(".base-note-block__content")).toHaveText(expectedAbstract);
    await expect(item).not.toContainText("guidance_analysis_response");
  }
  await noobot.page.keyboard.press("Escape");
  await expect(thinkingDetailsPanel).toBeHidden();

  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", false);
  await setHarnessCapability(noobot.page, "Planning Acceptance", false);
  await setHarnessRuntimeThresholds(noobot.page, {
    summaryTurns: 4,
    planUpdateTurns: 12,
    phaseAcceptanceTurns: 12,
  });
  await setRunSummaryPolicy(noobot.page, {
    phaseSummaryLoopTurns: 12,
    taskCheckLoopTurns: 12,
  });
  const resumedChainStatePath = `runtime/ops_workdir/pbe035-resumed-chain-${Date.now()}-${testInfo.workerIndex}.json`;
  const resumedChainCommand = [
    'node -e "',
    "const fs=require('fs');",
    `const p='${resumedChainStatePath}';`,
    "const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{step:0};",
    "if(s.step>=5)throw new Error('chain already complete');",
    "s.step+=1;fs.mkdirSync('runtime/ops_workdir',{recursive:true});",
    "fs.writeFileSync(p,JSON.stringify(s));console.log(JSON.stringify({step:s.step}));",
    '"',
  ].join("");
  const commandCountBeforeSecondSend = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "继续上一轮 Session。严格串行调用下面完全相同的 execute_script 命令五次，每次必须等待上一条实际结果后才能调用下一次：",
        resumedChainCommand,
        "第五次成功后汇总五个实际 step 值并结束。不得并行调用，不得提前回答。",
      ].join(" "),
    ),
  );
  const secondSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    commandCountBeforeSecondSend,
  );
  const secondProcessing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    secondSend.identity.turnScopeId,
  );
  const secondHarness = await waitForHarnessRun(
    noobot.userId,
    secondProcessing.dialogProcessId,
    (candidate) => {
      const events = harnessCapabilityEvents(candidate.events);
      const failure = events.find((event) => event.event === "capability_flow_failed");
      expect(failure, JSON.stringify(failure?.detail || {})).toBeFalsy();
      const names = new Set(events.map((event) => event.event));
      return (
        names.has("summary_scheduled_by_turn_threshold") &&
        names.has("summary_checkpoint_ready") &&
        names.has("summary_generated_by_separate_model")
      );
    },
  );
  const secondHarnessEvents = harnessCapabilityEvents(secondHarness.events);
  const secondSummarySchedule = secondHarnessEvents.find(
    (event) => event.event === "summary_scheduled_by_turn_threshold",
  );
  expect(secondSummarySchedule.detail).toMatchObject({
    triggerTurns: 4,
    thresholdSource: "runtime",
  });
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: secondSend.identity.turnScopeId,
    timeoutMs: 120000,
  });
  const allRecords = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const secondScopedRecords = allRecords.filter(
    (item) => item.turnScopeId === secondSend.identity.turnScopeId,
  );
  const secondInvocations = modelInvocationTraces(secondScopedRecords).filter(
    isMainAgentModelInvocation,
  );
  expect(secondInvocations.length).toBeLessThanOrEqual(15);
  expect(secondScopedRecords.some((item) => item.event === "summary_checkpoint_committed")).toBe(
    true,
  );
  assertCompactExecutionContext(secondInvocations);
  expect(
    secondInvocations.every((invocation) =>
      invocation.data.messages.preview.every(
        (message) => message.internalType !== "noobot.task_check_prompt",
      ),
    ),
  ).toBe(true);
  expect(
    secondInvocations.some((invocation) =>
      invocation.data.messages.preview.some(
        (message) => message.messageId === latestCheckResult.messageUid,
      ),
    ),
  ).toBe(true);
});
