/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  isCanonicalActivityTimelineFact,
  mergeCanonicalActivityTimelines,
  projectCanonicalActivityTimelineEvent,
  reduceCanonicalActivityTimeline,
} from "../src/activity-timeline.js";
import { createEventEnvelope } from "../src/envelope.js";
import { EVENT_FAMILY } from "../src/event-registry.js";
import {
  MESSAGE_EVENT_TYPE,
  MESSAGE_EVENT_WIRE_EVENT,
  validateMessageEventPayload,
} from "../src/message-event.js";

function activityEnvelope(overrides = {}, envelopeOverrides = {}) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    identity: {
      eventId: "activity-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
      messageId: "message-1",
      ...(envelopeOverrides.identity || {}),
    },
    causality: {},
    ordering: {
      domain: "message-event",
      scopeId: "message-1",
      sequence: 1,
      ...(envelopeOverrides.ordering || {}),
    },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-09-05T03:39:01.897Z",
    payload: {
      eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      text: "先确认当前真实状态。",
      ...overrides,
    },
  });
}

test("projects one exact canonical activity fact from an authoritative envelope", () => {
  const fact = projectCanonicalActivityTimelineEvent(activityEnvelope());

  assert.deepEqual(fact, {
    eventId: "activity-1",
    eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
    text: "先确认当前真实状态。",
    activityKind: "",
    purpose: "",
    pluginFlow: "",
    chain: "",
    relayCorrelationId: "",
    sequence: 1,
    sequenceScopeId: "message-1",
    sequenceDomain: "message-event",
    authority: "authoritative",
    timestamp: "2026-09-05T03:39:01.897Z",
    sessionId: "session-1",
    dialogProcessId: "dialog-1",
    turnScopeId: "turn-1",
    messageId: "message-1",
    presentationMessageId: "presentation-1",
  });
  assert.equal(isCanonicalActivityTimelineFact(fact), true);
  assert.deepEqual(Object.keys(fact).sort(), [
    "activityKind",
    "authority",
    "chain",
    "dialogProcessId",
    "eventId",
    "eventType",
    "messageId",
    "pluginFlow",
    "presentationMessageId",
    "purpose",
    "relayCorrelationId",
    "sequence",
    "sequenceDomain",
    "sequenceScopeId",
    "sessionId",
    "text",
    "timestamp",
    "turnScopeId",
  ]);
});

test("rejects incomplete envelopes and noncanonical activity records", () => {
  assert.equal(
    projectCanonicalActivityTimelineEvent({
      ...activityEnvelope(),
      ordering: { domain: "message-event", scopeId: "", sequence: 0 },
    }),
    null,
  );
  assert.equal(
    isCanonicalActivityTimelineFact({
      eventId: "synthetic-1",
      event: "legacy_alias",
      type: "legacy_alias",
      text: "duplicate",
    }),
    false,
  );
  assert.deepEqual(
    validateMessageEventPayload({
      eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      presentationMessageId: "presentation-1",
    }).errors,
    ["missing_text"],
  );
});

test("reduces repeated event identity to one fact and excludes legacy aliases", () => {
  const first = activityEnvelope();
  const repeated = activityEnvelope({ text: "authoritative replacement" });
  const timeline = reduceCanonicalActivityTimeline(
    reduceCanonicalActivityTimeline([], first),
    repeated,
  );

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].text, "authoritative replacement");
  assert.deepEqual(
    mergeCanonicalActivityTimelines(timeline, [
      {
        eventId: "synthetic-1",
        event: "legacy_alias",
        type: "legacy_alias",
        text: "duplicate",
      },
    ]),
    timeline,
  );
});

test("aggregates activity deltas by activity identity without losing token boundaries", () => {
  const first = activityEnvelope(
    {
      eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
      activityId: "activity-stream-1",
      activityKind: "guidance_analysis",
      activityEventType: MESSAGE_EVENT_TYPE.THINKING,
      text: "先确认 ",
    },
    { identity: { eventId: "delta-1" }, ordering: { sequence: 0 } },
  );
  const second = activityEnvelope(
    {
      eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
      activityId: "activity-stream-1",
      activityKind: "guidance_analysis",
      activityEventType: MESSAGE_EVENT_TYPE.THINKING,
      text: "当前状态。",
    },
    { identity: { eventId: "delta-2" }, ordering: { sequence: 0 } },
  );

  const timeline = reduceCanonicalActivityTimeline(
    reduceCanonicalActivityTimeline([], first),
    second,
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].activityId, "activity-stream-1");
  assert.equal(timeline[0].text, "先确认 当前状态。");
  assert.equal(timeline[0].eventType, MESSAGE_EVENT_TYPE.THINKING);
});

test("a standalone activity event replaces the fragments streamed under the same activityId", () => {
  const delta = activityEnvelope(
    {
      eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
      activityId: "activity-main-1",
      activityKind: "main_model_analysis",
      activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      text: "partial ",
    },
    { identity: { eventId: "delta-1" }, ordering: { sequence: 0 } },
  );
  const completed = activityEnvelope(
    {
      eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      activityId: "activity-main-1",
      activityKind: "main_model_analysis",
      text: "final analysis",
    },
    { identity: { eventId: "completed-1" }, ordering: { sequence: 2 } },
  );

  const timeline = reduceCanonicalActivityTimeline(
    reduceCanonicalActivityTimeline([], delta),
    completed,
  );
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].text, "final analysis");
  assert.equal(timeline[0].eventId, "completed-1");
  assert.equal(timeline[0].eventType, MESSAGE_EVENT_TYPE.MODEL_ANALYSIS);
});

test("merging snapshots keeps one fact per activityId with the latest sequence", () => {
  const streaming = projectCanonicalActivityTimelineEvent(
    activityEnvelope(
      {
        eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
        activityId: "activity-main-1",
        activityKind: "main_model_analysis",
        activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
        text: "partial",
      },
      { identity: { eventId: "delta-1" }, ordering: { sequence: 0 } },
    ),
  );
  const completed = projectCanonicalActivityTimelineEvent(
    activityEnvelope(
      {
        eventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
        activityId: "activity-main-1",
        text: "final analysis",
      },
      { identity: { eventId: "completed-1" }, ordering: { sequence: 2 } },
    ),
  );

  assert.deepEqual(mergeCanonicalActivityTimelines([completed], [streaming]), [completed]);
  assert.deepEqual(mergeCanonicalActivityTimelines([streaming], [completed]), [completed]);
});

test("activity deltas must pass protocol validation to enter the timeline", () => {
  const invalidDelta = activityEnvelope(
    {
      eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
      activityKind: "main_model_analysis",
      activityEventType: MESSAGE_EVENT_TYPE.MODEL_ANALYSIS,
      text: "orphan",
    },
    { identity: { eventId: "delta-invalid" }, ordering: { sequence: 0 } },
  );
  assert.equal(projectCanonicalActivityTimelineEvent(invalidDelta), null);
});

test("only standalone activity events are durable; activity deltas are transport fragments", async () => {
  const { isCanonicalActivityMessageEvent, isDurableActivityMessageEvent } =
    await import("../src/activity-timeline.js");
  const { createEventEnvelope, EVENT_FAMILY } = await import("../src/index.js");
  const { MESSAGE_EVENT_WIRE_EVENT, isTransientMessageEventType } =
    await import("../src/message-event.js");
  const envelope = (eventId, eventType, payload = {}) =>
    createEventEnvelope({
      family: EVENT_FAMILY.MESSAGE_TIMELINE,
      identity: {
        eventId,
        eventType: MESSAGE_EVENT_WIRE_EVENT,
        sessionId: "session-1",
        turnScopeId: "turn-1",
        messageId: "message-1",
      },
      causality: {},
      ordering: {
        domain: "message-event",
        scopeId: "message-1",
        sequence: isTransientMessageEventType(eventType) ? 0 : 1,
      },
      producer: { type: "agent", id: "agent-1" },
      occurredAt: "2026-09-05T03:39:01.000Z",
      payload: { eventType, presentationMessageId: "p-1", dialogProcessId: "d-1", ...payload },
    });
  const delta = envelope("d", "activity_delta", {
    activityId: "a",
    activityKind: "main_model_analysis",
    activityEventType: "model_analysis_delta",
    text: "x",
  });
  assert.equal(isCanonicalActivityMessageEvent(delta), true);
  assert.equal(isDurableActivityMessageEvent(delta), false);
  assert.equal(
    isDurableActivityMessageEvent(
      envelope("c", "model_analysis_delta", { activityId: "a", text: "x" }),
    ),
    true,
  );
  assert.equal(isDurableActivityMessageEvent(envelope("t", "thinking", { text: "x" })), true);
  assert.equal(
    isDurableActivityMessageEvent(envelope("u", "tool_call_end", { toolCallId: "c" })),
    false,
  );
});
