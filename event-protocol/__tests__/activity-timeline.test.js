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
      eventType: MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT,
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
    eventType: MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT,
    text: "先确认当前真实状态。",
    activityKind: "",
    purpose: "",
    pluginFlow: "",
    chain: "",
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
    projectCanonicalActivityTimelineEvent(
      {
        ...activityEnvelope(),
        ordering: { domain: "message-event", scopeId: "", sequence: 0 },
      },
    ),
    null,
  );
  assert.equal(
    isCanonicalActivityTimelineFact({
      eventId: "synthetic-1",
      event: "main_model_content",
      type: "main_model_content",
      text: "duplicate",
    }),
    false,
  );
  assert.deepEqual(
    validateMessageEventPayload({
      eventType: MESSAGE_EVENT_TYPE.MAIN_MODEL_CONTENT,
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
        event: "main_model_content",
        type: "main_model_content",
        text: "duplicate",
      },
    ]),
    timeline,
  );
});
