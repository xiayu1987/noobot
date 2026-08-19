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
  modelInvocationTraces,
  readSessionExecutionEventTree,
  readSnapshots,
  waitForSessionExecutionEventTree,
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
import { toolEventsForTurn } from "../helpers/thinking-tool-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

function firstMainTraceForTurn(records = [], turnScopeId = "") {
  return modelInvocationTraces(records)
    .filter((record) => record.turnScopeId === turnScopeId && isMainAgentModelInvocation(record))
    .sort(
      (left, right) =>
        Number(left.data?.invocationSequence || 0) - Number(right.data?.invocationSequence || 0),
    )[0];
}

test("@full PBE-045 并行工具停止时结果完整进入快照并由 Continue 恢复", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(600000);
  await selectPlugins(noobot.page, []);

  const commands = [
    `node -e "setTimeout(()=>console.log(JSON.stringify({slot:1,ok:true})),300)"`,
    `node -e "setTimeout(()=>console.log(JSON.stringify({slot:2,ok:true})),500)"`,
    `node -e "setTimeout(()=>console.log(JSON.stringify({slot:3,ok:true})),30000)"`,
    `node -e "setTimeout(()=>console.log(JSON.stringify({slot:4,ok:true})),700)"`,
  ];
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "在同一个 assistant 工具调用响应中并行发起恰好四次 execute_script，禁止串行等待。",
        ...commands.map((command, index) => `第 ${index + 1} 次的 command 必须精确为 ${command}。`),
        "必须等待四个实际结果后再回答；收到停止时不要伪造未完成结果。",
      ].join(" "),
    ),
  );
  const sent = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    sent.identity.turnScopeId,
  );
  const stoppedCommand = {
    ...sent,
    identity: { ...sent.identity, dialogProcessId: processing.dialogProcessId },
  };
  await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) => {
      const events = toolEventsForTurn(records, sent.identity.turnScopeId).filter(
        (record) => String(record.data?.tool || "").trim() === "execute_script",
      );
      return (
        events.filter((record) => record.event === "tool_call_start").length === 4 &&
        events.filter((record) => record.event === "tool_call_end" && record.data?.success === true)
          .length >= 2
      );
    },
    { timeoutMs: 240000 },
  );
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    sent.identity.turnScopeId,
  );

  const snapshots = await readSnapshots(noobot.userId, noobot.sessionId);
  expect(snapshots).toHaveLength(1);
  const snapshot = snapshots[0];
  assertSerializedModelMessageSnapshot(snapshot);

  const stoppedRecords = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) => {
      const events = toolEventsForTurn(records, sent.identity.turnScopeId).filter(
        (record) => String(record.data?.tool || "").trim() === "execute_script",
      );
      return events.filter((record) => record.event === "tool_call_end").length === 4;
    },
  );
  const toolEvents = toolEventsForTurn(stoppedRecords, sent.identity.turnScopeId).filter(
    (record) => String(record.data?.tool || "").trim() === "execute_script",
  );
  const starts = toolEvents.filter((record) => record.event === "tool_call_start");
  const ends = toolEvents.filter((record) => record.event === "tool_call_end");
  expect(starts).toHaveLength(4);
  expect(ends).toHaveLength(4);
  for (const start of starts) {
    const result = ends.find((candidate) => candidate.data?.toolCallId === start.data?.toolCallId);
    expect(result, `missing parallel result for ${start.data?.toolCallId}`).toBeTruthy();
    expect(String(result.data?.result || "").trim()).toBeTruthy();
  }
  const aborted = ends.filter((record) => record.data?.success !== true);
  expect(ends.filter((record) => record.data?.success === true).length).toBeGreaterThanOrEqual(2);
  expect(aborted.length).toBeGreaterThanOrEqual(1);
  for (const record of aborted) {
    expect(JSON.parse(record.data.result)).toMatchObject({
      toolName: "execute_script",
      ok: false,
      status: "aborted",
      stopType: "user_stop",
    });
  }

  const beforeContinue = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(
    noobot.page,
    "继续。只根据快照中四个已配对的工具结果说明哪些完成、哪个被停止，禁止重新调用工具。",
  );
  const continued = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.continue",
    beforeContinue,
  );
  assertContinuation(stoppedCommand, continued);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: continued.identity.turnScopeId,
    timeoutMs: 240000,
  });

  const finalRecords = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const trace = firstMainTraceForTurn(finalRecords, continued.identity.turnScopeId);
  expect(trace).toBeTruthy();
  assertSnapshotRecoveryInModelInput({ snapshot, continuation: continued, trace });
  expect(toolEventsForTurn(finalRecords, continued.identity.turnScopeId)).toHaveLength(0);
});
