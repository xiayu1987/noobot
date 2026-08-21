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
  setHarnessGuidanceAnalysisIntensity,
  setHarnessRuntimeThresholds,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { assertCapabilityModelTraces, assertHarnessRun } from "../helpers/harness-assertions.js";
import {
  modelInvocationTraces,
  readSessionFact,
  readSessionExecutionEventTree,
  readSessionTurnMessages,
  waitForHarnessRun,
} from "../helpers/persistence-audit.js";
import {
  assertModelInvocationTraceSet,
  auditModelPrefixStability,
  isMainAgentModelInvocation,
} from "../helpers/model-message-assertions.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

const HARNESS_COMPLETION_TIMEOUT_MS = 780000;
const HARNESS_AUDIT_TIMEOUT_MS = 120000;

const EXPECTED_CAPABILITY_PURPOSES = Object.freeze([
  "planning",
  "guidance",
  "summary",
  "planning_revision",
  "planning_refinement",
  "phase_acceptance",
  "acceptance_semantic_validation",
]);

const EXPECTED_MAIN_RELAYS = Object.freeze([
  "planning",
  "planning_followup",
  "guidance",
  "summary",
  "planning_revision",
  "next_phase_plan",
  "next_phase_plan_followup",
  "planning_refinement",
  "next_phase_plan_refinement",
  "next_phase_plan_refinement_followup",
  "phase_acceptance",
  "acceptance_semantic_validation",
]);

function capabilityEvents(records = []) {
  return records.flatMap((record) =>
    Array.isArray(record?.capabilityLogs) ? record.capabilityLogs : [],
  );
}

function toolResultName(message = {}) {
  if (message.role !== "tool") return "";
  return String(toolResultPayload(message)?.toolName || "").trim();
}

function toolResultPayload(message = {}) {
  if (message.role !== "tool") return null;
  try {
    return JSON.parse(String(message.content || "{}"));
  } catch {
    return null;
  }
}

function toolCallId(call = {}) {
  return String(call.id || call.tool_call_id || "").trim();
}

function toolCallName(call = {}) {
  return String(call.name || call.function?.name || "").trim();
}

function toolCallArgs(call = {}) {
  if (call.args && typeof call.args === "object") return call.args;
  return JSON.parse(String(call.function?.arguments || "{}"));
}

function toolCallNames(message = {}) {
  if (message.role !== "assistant") return [];
  const calls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : Array.isArray(message.toolCalls)
      ? message.toolCalls
      : [];
  return calls
    .map((call) => String(call?.function?.name || call?.name || "").trim())
    .filter(Boolean);
}

function assertCheckpointMessages(session, messages, turnScopeId, expectedRewriteCount) {
  const checkpoint = session.turnSummaryCheckpoints?.[turnScopeId];
  expect(checkpoint?.checkpointRevision).toBeGreaterThan(0);
  expect(checkpoint.checkpointRevision).toBe(expectedRewriteCount);
  expect(checkpoint.dialogProcessId).toBeTruthy();
  const receipts = Array.isArray(checkpoint.receipts) ? checkpoint.receipts : [];
  expect(receipts).toHaveLength(checkpoint.checkpointRevision);
  expect(receipts.map((receipt) => receipt.checkpointRevision)).toEqual(
    Array.from({ length: checkpoint.checkpointRevision }, (_, index) => index + 1),
  );
  const summarizedIds = new Set(receipts.flatMap((receipt) => receipt.summarizedMessageUids || []));
  expect(summarizedIds.size).toBeGreaterThan(0);
  const byUid = new Map(messages.map((message) => [message.messageUid, message]));
  for (const messageUid of summarizedIds) {
    expect(byUid.get(messageUid)?.summarized, messageUid).toBe(true);
  }
}

function assertCapabilityPurposesAndMainRelays(modelTraces = []) {
  const capabilityPurposes = new Set(
    modelTraces
      .filter((record) => !isMainAgentModelInvocation(record))
      .map((record) => record.data?.invocation?.purpose),
  );
  for (const purpose of EXPECTED_CAPABILITY_PURPOSES) {
    expect(capabilityPurposes.has(purpose), `missing capability provider call: ${purpose}`).toBe(
      true,
    );
  }

  const mainRelayTypes = new Set(
    modelTraces
      .filter(isMainAgentModelInvocation)
      .flatMap((record) => record.data?.messages?.evidence || [])
      .map((message) => String(message?.injectedMessageType || "").trim())
      .filter(Boolean),
  );
  for (const purpose of EXPECTED_MAIN_RELAYS) {
    expect(
      mainRelayTypes.has(`separate_model_relay:${purpose}`),
      `missing main-model relay: ${purpose}`,
    ).toBe(true);
  }
}

test("@full PBE-033 Harness 低轮次完整流程与模型注入闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(HARNESS_COMPLETION_TIMEOUT_MS + HARNESS_AUDIT_TIMEOUT_MS);
  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", true);
  await setHarnessCapability(noobot.page, "Planning Acceptance", true);
  await setHarnessGuidanceAnalysisIntensity(noobot.page, 9);
  await setHarnessRuntimeThresholds(noobot.page, {
    summaryTurns: 4,
    planUpdateTurns: 6,
    phaseAcceptanceTurns: 3,
  });

  const chainStatePath = `runtime/ops_workdir/pbe033-chain-${Date.now()}-${testInfo.workerIndex}.json`;
  const chainCommand = [
    'node -e "',
    "const fs=require('fs'),crypto=require('crypto');",
    `const p='${chainStatePath}';`,
    "const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{step:0,values:[]};",
    "if(s.step>=7)throw new Error('chain already complete');",
    "let v='';",
    "if(s.step===0)v=crypto.randomBytes(16).toString('hex');",
    "if(s.step===1)v=crypto.createHash('sha256').update(s.values[0]).digest('hex');",
    "if(s.step===2)v=s.values[1].slice(0,8);",
    "if(s.step===3)v=s.values[2].split('').reverse().join('');",
    "if(s.step===4)v=String(s.values[3].length);",
    "if(s.step===5)v=s.values[3].toUpperCase();",
    "if(s.step===6)v=crypto.createHash('sha256').update(s.values[5]).digest('hex');",
    "s.values.push(v);s.step+=1;fs.mkdirSync('runtime/ops_workdir',{recursive:true});",
    "fs.writeFileSync(p,JSON.stringify(s));",
    "console.log(JSON.stringify({step:s.step,value:v}));",
    '"',
  ].join("");

  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "完成一个七步串行计算链，每一步分别调用一次 execute_script。",
        "七次调用必须逐次使用下面完全相同的 command，不得改写命令、不得并行；命令用唯一状态文件保存前序真实输出并只推进一个 step，因此 checkpoint 后也必须继续调用同一命令。",
        `command: ${chainCommand}`,
        "命令依次完成：生成随机十六进制 token、计算 token 的 SHA-256、返回哈希前八位、反转八位字符串、返回反转串长度、转为大写、计算大写串的 SHA-256。",
        "观察到 step=7 后调用 request_plan_refinement 一次，再调用 request_task_acceptance，mode=active；最后汇总七次实际 JSON 输出。",
      ].join(" "),
    ),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.preferences.pluginModelConfig.harness).toMatchObject({
    capabilityProfile: {
      planning: { enabled: true },
      acceptance: { enabled: true },
    },
    guidance: {
      analysis: { turnsThreshold: 2 },
      summary: { turnsThreshold: 4 },
    },
    planning: {
      planUpdate: { triggerTurnsThreshold: 6 },
    },
    acceptance: {
      phase: { triggerTurnsThreshold: 3 },
    },
  });
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    send.identity.turnScopeId,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: HARNESS_COMPLETION_TIMEOUT_MS,
  });

  const requiredEvents = new Set([
    "planning_checklist_captured",
    "planning_revision_scheduled_by_turn_threshold",
    "guidance_analysis_scheduled_by_turn_threshold",
    "summary_scheduled_by_turn_threshold",
    "summary_generated_by_separate_model",
    "summary_messages_marked",
    "phase_acceptance_scheduled_by_turn_threshold",
    "phase_acceptance_completed",
    "acceptance_semantic_validation_completed",
    "review_report_generated",
  ]);
  const harness = await waitForHarnessRun(
    noobot.userId,
    processing.dialogProcessId,
    (candidate) => {
      const names = new Set(capabilityEvents(candidate.events).map((event) => event.event));
      return (
        candidate.run?.status === "success" && [...requiredEvents].every((name) => names.has(name))
      );
    },
    { timeoutMs: 30000 },
  );
  assertHarnessRun(harness.run, {
    dialogProcessId: processing.dialogProcessId,
    status: "success",
  });
  assertCapabilityModelTraces(harness.capabilityTraces);

  const events = capabilityEvents(harness.events);
  for (const eventName of requiredEvents) {
    expect(
      events.some((event) => event.event === eventName),
      eventName,
    ).toBe(true);
  }
  const thresholdEvents = new Map([
    ["guidance_analysis_scheduled_by_turn_threshold", 2],
    ["planning_revision_scheduled_by_turn_threshold", 6],
    ["summary_scheduled_by_turn_threshold", 4],
    ["phase_acceptance_scheduled_by_turn_threshold", 3],
  ]);
  for (const [eventName, triggerTurns] of thresholdEvents) {
    const event = events.find((item) => item.event === eventName);
    expect(event.detail.triggerTurns, eventName).toBe(triggerTurns);
    expect(event.detail.thresholdSource, eventName).toBe("runtime");
  }
  const summaryMark = events.find((event) => event.event === "summary_messages_marked");
  expect(
    Number(summaryMark.detail?.markedCount || summaryMark.detail?.messageCount || 0),
  ).toBeGreaterThan(0);

  const modelTraces = modelInvocationTraces(
    await readSessionExecutionEventTree(noobot.userId, noobot.sessionId),
  ).filter((record) => record.turnScopeId === send.identity.turnScopeId);
  const prefixAudit = assertModelInvocationTraceSet(modelTraces, {
    rootSessionId: noobot.sessionId,
  });
  const mainPrefixAudit = auditModelPrefixStability(modelTraces.filter(isMainAgentModelInvocation));
  const mainModelTraces = modelTraces.filter(isMainAgentModelInvocation);
  for (const trace of mainModelTraces) {
    expect(trace.data.messages.roles.system).toBeGreaterThan(0);
    expect(
      trace.data.messages.evidence.some((message) => message.internalType === "system_context"),
      `base system context missing from main invocation ${trace.data.invocationId}`,
    ).toBe(true);
  }
  expect(mainPrefixAudit.violations).toEqual([]);
  expect(mainPrefixAudit.stableComparisonCount).toBeGreaterThan(0);
  expect(mainPrefixAudit.checkpointRewriteCount).toBeGreaterThan(0);
  assertCapabilityPurposesAndMainRelays(modelTraces);

  const tracedPurposes = new Set(
    harness.capabilityTraces.map((record) => record.detail?.purpose).filter(Boolean),
  );
  for (const purpose of EXPECTED_CAPABILITY_PURPOSES) {
    expect(tracedPurposes.has(purpose), `missing Harness capability trace: ${purpose}`).toBe(true);
  }

  const session = await readSessionFact(noobot.userId, noobot.sessionId);
  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  assertCheckpointMessages(
    session,
    messages,
    send.identity.turnScopeId,
    mainPrefixAudit.checkpointRewriteCount,
  );
  const toolResultNames = messages.map(toolResultName).filter(Boolean);
  const calledToolNames = messages.flatMap(toolCallNames);
  const chainCalls = messages.flatMap((message) =>
    (message.tool_calls || []).filter(
      (call) =>
        toolCallName(call) === "execute_script" && toolCallArgs(call).command === chainCommand,
    ),
  );
  const chainCallIds = new Set(chainCalls.map(toolCallId));
  const chainResults = messages.filter(
    (message) =>
      toolResultName(message) === "execute_script" &&
      chainCallIds.has(String(message.tool_call_id || "").trim()),
  );
  const successfulChainResults = chainResults.filter(
    (message) => toolResultPayload(message)?.ok === true,
  );
  const rejectedChainResults = chainResults.filter(
    (message) => toolResultPayload(message)?.ok === false,
  );
  expect(successfulChainResults).toHaveLength(7);
  expect(chainCalls.length).toBeGreaterThanOrEqual(successfulChainResults.length);
  expect(rejectedChainResults.length).toBe(chainCalls.length - successfulChainResults.length);
  for (const result of rejectedChainResults) {
    expect(JSON.stringify(toolResultPayload(result))).toMatch(/chain already complete/i);
  }
  expect(toolResultNames.filter((name) => name === "execute_script").length).toBeGreaterThanOrEqual(
    successfulChainResults.length,
  );
  expect(calledToolNames.filter((name) => name === "request_plan_refinement")).toHaveLength(1);
  expect(calledToolNames.filter((name) => name === "request_task_acceptance")).toHaveLength(1);
});
