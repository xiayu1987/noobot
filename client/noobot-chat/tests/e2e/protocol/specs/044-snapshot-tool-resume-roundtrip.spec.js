/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectPlugins,
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  modelInvocationTraces,
  readSessionExecutionEventTree,
  readSnapshots,
  waitForSessionExecutionEventTree,
  workspaceRoot,
} from "../helpers/persistence-audit.js";
import { isMainAgentModelInvocation } from "../helpers/model-message-assertions.js";
import {
  assertSerializedModelMessageSnapshot,
  assertSnapshotRecoveryInModelInput,
} from "../helpers/snapshot-assertions.js";
import {
  assertContinuation,
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import {
  assertCanonicalToolPairs,
  toolEventsForTurn,
} from "../helpers/thinking-tool-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

function executeScriptEvents(records = [], turnScopeId = "") {
  return toolEventsForTurn(records, turnScopeId).filter(
    (record) => String(record.data?.tool || "").trim() === "execute_script",
  );
}

async function waitForExecuteScriptResults(userId, sessionId, turnScopeId, minimum) {
  return waitForSessionExecutionEventTree(
    userId,
    sessionId,
    (records) =>
      executeScriptEvents(records, turnScopeId).filter(
        (record) => record.event === "tool_call_end" && record.data?.success === true,
      ).length >= minimum,
    { timeoutMs: 240000 },
  );
}

async function stopAfterTools({ noobot, protocolCapture, command, minimumToolResults = 1 }) {
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    command.identity.turnScopeId,
  );
  await waitForExecuteScriptResults(
    noobot.userId,
    noobot.sessionId,
    command.identity.turnScopeId,
    minimumToolResults,
  );
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    command.identity.turnScopeId,
  );
  const records = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  return {
    command: {
      ...command,
      identity: { ...command.identity, dialogProcessId: processing.dialogProcessId },
    },
    records,
  };
}

async function assertStoppedThinkingDetails(page, records, turnScopeId) {
  const expectedRecordCount = executeScriptEvents(records, turnScopeId).length;
  expect(expectedRecordCount).toBeGreaterThan(0);
  const shell = page.locator(".thinking-realtime-shell").last();
  await expect(shell).toBeVisible({ timeout: 60000 });
  const header = shell.locator(".el-collapse-item__header");
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  const action = shell.locator(".thinking-detail-action-button");
  await expect(action).toContainText(`(${expectedRecordCount})`);
  await action.click();
  const panel = page.locator(".thinking-details-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".el-tabs__item").first()).toContainText(`(${expectedRecordCount})`);
  await expect(
    panel.locator(".thinking-details-log-body .base-thinking-log-line.is-tool"),
  ).toHaveCount(expectedRecordCount);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
}

function firstMainTraceForTurn(records = [], turnScopeId = "") {
  return modelInvocationTraces(records)
    .filter((record) => record.turnScopeId === turnScopeId && isMainAgentModelInvocation(record))
    .sort(
      (left, right) =>
        Number(left.data?.invocationSequence || 0) - Number(right.data?.invocationSequence || 0),
    )[0];
}

test("@full PBE-044 工具链两次停止继续后的快照序列化与模型恢复闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, []);

  const baselineCommand = `node -e "console.log(JSON.stringify({phase:'baseline',ok:true}))"`;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `先且仅调用一次 execute_script，command 必须精确为 ${baselineCommand}；观察实际 JSON 后直接正常完成。`,
    ),
  );
  const baseline = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: baseline.identity.turnScopeId,
    timeoutMs: 240000,
  });
  const baselineRecords = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  assertCanonicalToolPairs(executeScriptEvents(baselineRecords, baseline.identity.turnScopeId), [
    "execute_script",
  ]);

  const stateRelativePath = `runtime/ops_workdir/pbe044-resume-${Date.now()}-${testInfo.workerIndex}.json`;
  const chainCommand = [
    'node -e "',
    "const fs=require('fs');",
    `const p='${stateRelativePath}';`,
    "const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{step:0};",
    "if(s.step>=8)throw new Error('chain already complete');",
    "s.step+=1;fs.mkdirSync('runtime/ops_workdir',{recursive:true});",
    "fs.writeFileSync(p,JSON.stringify(s));",
    "console.log(JSON.stringify({step:s.step}));",
    "setTimeout(()=>{},1200);",
    '"',
  ].join("");

  const beforeChain = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "执行八步串行工具链，每一步调用一次 execute_script。",
        `八次调用都必须使用完全相同的 command：${chainCommand}`,
        "每次观察实际 JSON 的 step 恰好递增 1 后再继续；到 step=8 后直接正常完成并汇总实际步骤。",
        "运行中即使收到停止，后续 Continue 也必须从已保存状态继续，禁止重做已经完成的 step。",
      ].join(" "),
    ),
  );
  const chainSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    beforeChain,
  );
  const firstStopped = await stopAfterTools({ noobot, protocolCapture, command: chainSend });
  await assertStoppedThinkingDetails(
    noobot.page,
    firstStopped.records,
    firstStopped.command.identity.turnScopeId,
  );

  const beforeFirstContinue = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, "继续上一条八步串行工具链，从快照中的下一步开始执行。");
  const firstContinue = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.continue",
    beforeFirstContinue,
  );
  assertContinuation(firstStopped.command, firstContinue);
  const secondStopped = await stopAfterTools({
    noobot,
    protocolCapture,
    command: firstContinue,
  });
  await assertStoppedThinkingDetails(
    noobot.page,
    secondStopped.records,
    secondStopped.command.identity.turnScopeId,
  );

  const beforeSecondContinue = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, "再次继续同一八步串行工具链，完成剩余步骤并正常结束。");
  const secondContinue = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.continue",
    beforeSecondContinue,
  );
  assertContinuation(secondStopped.command, secondContinue);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: secondContinue.identity.turnScopeId,
    timeoutMs: 360000,
  });

  const snapshots = await readSnapshots(noobot.userId, noobot.sessionId);
  expect(snapshots).toHaveLength(2);
  for (const snapshot of snapshots) assertSerializedModelMessageSnapshot(snapshot);
  const firstSnapshot = snapshots.find(
    (snapshot) => snapshot.turnScopeId === firstStopped.command.identity.turnScopeId,
  );
  const secondSnapshot = snapshots.find(
    (snapshot) => snapshot.turnScopeId === secondStopped.command.identity.turnScopeId,
  );
  expect(firstSnapshot).toBeTruthy();
  expect(secondSnapshot).toBeTruthy();

  const finalRecords = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const firstContinueTrace = firstMainTraceForTurn(
    finalRecords,
    firstContinue.identity.turnScopeId,
  );
  const secondContinueTrace = firstMainTraceForTurn(
    finalRecords,
    secondContinue.identity.turnScopeId,
  );
  expect(firstContinueTrace).toBeTruthy();
  expect(secondContinueTrace).toBeTruthy();
  assertSnapshotRecoveryInModelInput({
    snapshot: firstSnapshot,
    continuation: firstContinue,
    trace: firstContinueTrace,
  });
  assertSnapshotRecoveryInModelInput({
    snapshot: secondSnapshot,
    continuation: secondContinue,
    trace: secondContinueTrace,
  });

  const chainTurns = [
    firstStopped.command.identity.turnScopeId,
    secondStopped.command.identity.turnScopeId,
    secondContinue.identity.turnScopeId,
  ];
  const chainEvents = chainTurns.flatMap((turnScopeId) =>
    executeScriptEvents(finalRecords, turnScopeId),
  );
  const chainPairs = assertCanonicalToolPairs(chainEvents, Array(8).fill("execute_script"));
  expect(chainPairs.results).toHaveLength(8);
  const state = JSON.parse(
    await fs.readFile(path.join(workspaceRoot(), noobot.userId, stateRelativePath), "utf8"),
  );
  expect(state).toEqual({ step: 8 });
});
