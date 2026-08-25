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
import { MODEL_CONTEXT_SEQUENCE_POLICY } from "@noobot/model-protocol";

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

function hasSameCheckpointGrowth(records = []) {
  const flows = new Map();
  for (const trace of records) {
    const invocation = trace.data?.invocation || {};
    const key = [
      invocation.sessionId,
      invocation.dialogProcessId,
      invocation.flow,
      invocation.purpose,
      invocation.domain,
    ].join("|");
    const flow = flows.get(key) || [];
    flow.push(trace);
    flows.set(key, flow);
  }
  return [...flows.values()].some((flow) => {
    flow.sort(
      (left, right) =>
        Number(left.data?.invocationSequence || 0) - Number(right.data?.invocationSequence || 0),
    );
    return flow.some((current, index) => {
      if (index === 0) return false;
      const previous = flow[index - 1];
      return (
        Number(current.data?.context?.summaryCheckpointRevision || 0) ===
          Number(previous.data?.context?.summaryCheckpointRevision || 0) &&
        Number(current.data?.messages?.count || 0) > Number(previous.data?.messages?.count || 0)
      );
    });
  });
}

function assertAuxiliaryObserverProjection(mainMessages = [], auxiliaryTraces = []) {
  const auxiliaryPreview = auxiliaryTraces.flatMap((trace) => trace.data?.messages?.preview || []);
  expect(
    mainMessages.some((message) => message.role === "assistant" && message.tool_calls?.length),
    "main lane must contain canonical tool-call increments",
  ).toBe(true);
  expect(
    mainMessages.some((message) => message.role === "tool"),
    "main lane must contain canonical tool-result increments",
  ).toBe(true);
  expect(
    auxiliaryPreview.some(
      (message) =>
        message.role === "user" && /tool call:/i.test(String(message.contentPreview || "")),
    ),
    "auxiliary lane must project a canonical main-lane tool call as observer user context",
  ).toBe(true);
  expect(
    auxiliaryPreview.some(
      (message) => message.role === "assistant" && Number(message.contentLength || 0) > 0,
    ),
    "auxiliary lane must project a canonical main-lane tool result as observer assistant context",
  ).toBe(true);
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
    "const fs=require('fs');",
    `const p='${chainStatePath}';`,
    "const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{step:0,values:[]};",
    "if(s.step>=7)throw new Error('chain already complete');",
    "let v='';",
    "if(s.step===0)v='alpha';",
    "if(s.step===1)v=String(Number(s.values[0].length)+1);",
    "if(s.step===2)v=String(Number(s.values[1])+2);",
    "if(s.step===3)v=String(Number(s.values[2])+3);",
    "if(s.step===4)v=String(Number(s.values[3])+4);",
    "if(s.step===5)v=String(Number(s.values[4])+5);",
    "if(s.step===6)v=String(Number(s.values[5])+6);",
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
        "Run seven sequential execute_script calls with this exact command; wait for each result before the next: ",
        `${chainCommand} `,
        "After step 7, call request_plan_refinement once, then request_task_acceptance with mode active, and finish.",
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
  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  const prefixAudit = assertModelInvocationTraceSet(modelTraces, {
    rootSessionId: noobot.sessionId,
  });
  const mainPrefixAudit = auditModelPrefixStability(modelTraces.filter(isMainAgentModelInvocation));
  const capabilityModelTraces = modelTraces.filter((record) => !isMainAgentModelInvocation(record));
  const capabilityPrefixAudit = auditModelPrefixStability(capabilityModelTraces);
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
  expect(hasSameCheckpointGrowth(mainModelTraces), "main model context must grow append-only").toBe(
    true,
  );
  expect(
    capabilityModelTraces.every(
      (trace) =>
        trace.data?.invocation?.contextSequencePolicy ===
        MODEL_CONTEXT_SEQUENCE_POLICY.CHECKPOINT_APPEND_ONLY,
    ),
    "every Harness auxiliary request must use the checkpoint append-only protocol",
  ).toBe(true);
  expect(capabilityPrefixAudit.violations).toEqual([]);
  expect(capabilityPrefixAudit.checkedFlowCount).toBeGreaterThan(0);
  expect(capabilityPrefixAudit.stableComparisonCount).toBeGreaterThan(0);
  expect(capabilityPrefixAudit.checkpointRewriteCount).toBeGreaterThan(0);
  expect(
    hasSameCheckpointGrowth(capabilityModelTraces),
    "Harness auxiliary model context must grow append-only",
  ).toBe(true);
  assertAuxiliaryObserverProjection(messages, capabilityModelTraces);
  assertCapabilityPurposesAndMainRelays(modelTraces);

  const tracedPurposes = new Set(
    harness.capabilityTraces.map((record) => record.detail?.purpose).filter(Boolean),
  );
  for (const purpose of EXPECTED_CAPABILITY_PURPOSES) {
    expect(tracedPurposes.has(purpose), `missing Harness capability trace: ${purpose}`).toBe(true);
  }

  const session = await readSessionFact(noobot.userId, noobot.sessionId);
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
