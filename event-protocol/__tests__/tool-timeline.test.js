/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalToolTimelineEvent,
  countCanonicalThinkingDetailEvents,
  countCanonicalToolTimelineEvents,
  reduceCanonicalToolTimeline,
  requireCanonicalToolTimelineIdentity,
  resolveCanonicalToolTimelineStatus,
} from "../src/tool-timeline.js";
import { projectCanonicalActivityTimelineEvent } from "../src/activity-timeline.js";
import { createEventEnvelope } from "../src/envelope.js";
import { EVENT_FAMILY, getEventFamily } from "../src/event-registry.js";
import { MESSAGE_EVENT_WIRE_EVENT } from "../src/message-event.js";
import {
  SECURITY_EVIDENCE_SOURCE,
  createSecurityAssessment,
  raiseSecurityAssessment,
} from "@noobot/security-assessment-protocol";

const initialAssessment = createSecurityAssessment({
  toolName: "read_file",
  args: { riskLevel: "low" },
});
const raisedAssessment = raiseSecurityAssessment(initialAssessment, {
  source: SECURITY_EVIDENCE_SOURCE.NORMALIZED_RESOURCE,
  riskLevel: "high",
});

function event(eventType, sequence, extra = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: `event-${sequence}`,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "presentation-1", sequence },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: `2026-08-15T01:00:0${sequence}.000Z`,
    payload: {
      eventType,
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      toolCallId: "call-1",
      tool: "read_file",
      ...extra,
    },
  });
}

test("canonical tool timeline keeps failed terminal state across call and result order", () => {
  let timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_start", 1, {
      args: { filePath: "missing.txt", riskLevel: "low" },
      riskLevel: "low",
      securityAssessment: initialAssessment,
    }),
  );
  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_end", 2, {
      result: '{"ok":false,"error":"missing"}',
      success: false,
      riskLevel: "high",
      securityAssessment: raisedAssessment,
    }),
  );

  assert.equal(timeline[0].key, "call:call-1");
  assert.equal(timeline[0].tool, "read_file");
  assert.deepEqual(timeline[0].args, { filePath: "missing.txt", riskLevel: "low" });
  assert.equal(timeline[0].call.eventId, "event-1");
  assert.equal(timeline[0].resultEvent.eventId, "event-2");
  assert.equal(timeline[0].riskLevel, "high");
  assert.equal(timeline[0].status, "failed");
  assert.equal(timeline[0].success, false);
  assert.equal(resolveCanonicalToolTimelineStatus(timeline[0]), "failed");

  timeline = reduceCanonicalToolTimeline(
    timeline,
    event("tool_call_start", 1, {
      args: { filePath: "missing.txt", riskLevel: "low" },
      riskLevel: "low",
      securityAssessment: initialAssessment,
    }),
  );
  assert.equal(timeline[0].status, "failed");
});

test("canonical tool timeline marks successful results completed", () => {
  const timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 1, { result: '{"ok":true}', success: true }),
  );
  assert.equal(timeline[0].status, "completed");
  assert.equal(timeline[0].success, true);
});

test("canonical detail counts match the event records exposed to renderers", () => {
  const toolTimeline = [
    { call: { eventId: "call-1" }, resultEvent: { eventId: "result-1" } },
    { call: { eventId: "call-2" } },
  ];
  assert.equal(countCanonicalToolTimelineEvents(toolTimeline), 3);
  assert.equal(
    countCanonicalThinkingDetailEvents({
      toolTimeline,
      activityTimeline: [
        projectCanonicalActivityTimelineEvent(
          event("model_analysis_delta", 3, {
            toolCallId: undefined,
            tool: undefined,
            text: "model analysis",
          }),
        ),
      ],
    }),
    4,
  );
});

test("canonical realtime application mutates one indexed timeline without changing its wire shape", () => {
  const timeline = [];
  const indexByKey = new Map();
  const startResult = applyCanonicalToolTimelineEvent(
    timeline,
    event("tool_call_start", 1, { args: { filePath: "notes.txt" } }),
    { indexByKey },
  );
  const endResult = applyCanonicalToolTimelineEvent(
    timeline,
    event("tool_call_end", 2, { result: '{"ok":true}', success: true }),
    { indexByKey },
  );

  assert.equal(startResult, timeline);
  assert.equal(endResult, timeline);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].status, "completed");
  assert.equal(indexByKey.get("call:call-1"), 0);
  assert.deepEqual(Object.keys(timeline[0]).sort(), [
    "args",
    "call",
    "key",
    "result",
    "resultEvent",
    "riskLevel",
    "status",
    "success",
    "tool",
    "toolCallId",
  ]);
});

test("canonical realtime application remains linear for long tool runs", () => {
  const timeline = [];
  const indexByKey = new Map();
  const startedAt = performance.now();
  for (let sequence = 1; sequence <= 5000; sequence += 1) {
    applyCanonicalToolTimelineEvent(
      timeline,
      event("tool_call_start", sequence, {
        toolCallId: `call-${sequence}`,
        args: { filePath: `file-${sequence}.txt` },
      }),
      { indexByKey },
    );
  }
  const elapsedMs = performance.now() - startedAt;

  assert.equal(timeline.length, 5000);
  assert.equal(indexByKey.size, 5000);
  assert.ok(elapsedMs < 1000, `5000 incremental events took ${elapsedMs.toFixed(1)}ms`);
});

test("canonical tool timeline carries tool_call_end resourceRefs into resultEvent", () => {
  const resourceRefs = [
    { resourceId: "res_1", source: "workspace", logical: { view: "workspace", path: "a.txt" } },
  ];
  const timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 2, { result: "{}", success: true, resourceRefs }),
  );
  assert.deepEqual(timeline[0].resultEvent.resourceRefs, resourceRefs);
  const empty = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 3, { result: "{}", success: true }),
  );
  assert.equal("resourceRefs" in empty[0].resultEvent, false);
});

test("canonical tool timeline carries tool_call_end mutationRefs into resultEvent", () => {
  const mutationRefs = [{ mutationId: "m_1", revision: 1 }];
  const timeline = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 2, { result: "{}", success: true, mutationRefs }),
  );
  assert.deepEqual(timeline[0].resultEvent.mutationRefs, mutationRefs);
  const empty = reduceCanonicalToolTimeline(
    [],
    event("tool_call_end", 3, { result: "{}", success: true, mutationRefs: [] }),
  );
  assert.equal("mutationRefs" in empty[0].resultEvent, false);
});

test("tool timeline identity accepts only the reducer-written key call:<toolCallId>", () => {
  assert.deepEqual(
    requireCanonicalToolTimelineIdentity({ key: "call:a", toolCallId: "a", tool: "read_file" }),
    { key: "call:a", toolCallId: "a" },
  );
  for (const item of [
    { key: "call:a" },
    { toolCallId: "a" },
    { key: "call:b", toolCallId: "a" },
    { key: "a", toolCallId: "a" },
    { key: "call:", toolCallId: "" },
    { key: "call:1", toolCallId: 1 },
  ]) {
    assert.throws(() => requireCanonicalToolTimelineIdentity(item), TypeError);
  }
});

const taskCheckReceiptFixture = Object.freeze({
  state: "CONTINUE",
  abstract: "abstract",
  nextAction: "next",
  contentHash: `sha256:${"a".repeat(64)}`,
});

function taskCheckEntry(overrides = {}) {
  return {
    key: "call:tc-1",
    toolCallId: "tc-1",
    tool: "task_check",
    success: true,
    resultEvent: { eventId: "e-1", timestamp: "2026-01-01T00:00:00.000Z" },
    result: JSON.stringify({
      ok: true,
      toolName: "task_check",
      protocolVersion: 1,
      summary: taskCheckReceiptFixture,
    }),
    ...overrides,
  };
}

test("projectTaskCheckReceipt parses a successful task_check result", async () => {
  const { projectTaskCheckReceipt } = await import("../src/tool-timeline.js");
  assert.deepEqual(
    { ...projectTaskCheckReceipt(taskCheckEntry()) },
    { ...taskCheckReceiptFixture },
  );
});

test("projectTaskCheckReceipt returns null for non task_check, running or failed entries", async () => {
  const { projectTaskCheckReceipt } = await import("../src/tool-timeline.js");
  assert.equal(projectTaskCheckReceipt(taskCheckEntry({ tool: "read_file" })), null);
  assert.equal(projectTaskCheckReceipt(taskCheckEntry({ resultEvent: undefined })), null);
  assert.equal(projectTaskCheckReceipt(taskCheckEntry({ success: false })), null);
});

test("projectTaskCheckReceipt rejects successful results that break the task_check protocol", async () => {
  const { projectTaskCheckReceipt } = await import("../src/tool-timeline.js");
  assert.throws(() => projectTaskCheckReceipt(taskCheckEntry({ result: "plain" })));
  assert.throws(
    () =>
      projectTaskCheckReceipt(
        taskCheckEntry({ result: JSON.stringify({ ok: true, protocolVersion: 2, summary: {} }) }),
      ),
    /protocolVersion/,
  );
  assert.throws(
    () =>
      projectTaskCheckReceipt(
        taskCheckEntry({
          result: JSON.stringify({ ok: true, protocolVersion: 1, summary: { state: "X" } }),
        }),
      ),
    /NOOBOT_TASK_CHECK/,
  );
});

test("selectTaskCheckReceipt reads the projected receipt from compacted summary entries", async () => {
  const { selectTaskCheckReceipt } = await import("../src/tool-timeline.js");
  const { result: _result, ...compacted } = taskCheckEntry();
  assert.equal(selectTaskCheckReceipt(compacted), null);
  assert.deepEqual(
    selectTaskCheckReceipt({ ...compacted, taskCheckReceipt: taskCheckReceiptFixture }),
    taskCheckReceiptFixture,
  );
  assert.deepEqual({ ...selectTaskCheckReceipt(taskCheckEntry()) }, { ...taskCheckReceiptFixture });
});
