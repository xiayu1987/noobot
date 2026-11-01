/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import {
  assertSessionArtifactEvents,
  createPluginArtifactEnvelope,
  createEventEnvelope,
  EVENT_FAMILY,
  getEventFamily,
  validateProtocolEvent,
} from "../src/index.js";
import { MESSAGE_EVENT_SEQUENCE_DOMAIN, MESSAGE_EVENT_WIRE_EVENT } from "../src/message-event.js";

const INVALID = { code: SESSION_ERROR_CODE.SESSION_ARTIFACT_EVENTS_INVALID };
function artifact() {
  return createPluginArtifactEnvelope({
    pluginId: "sample",
    artifactType: "report",
    artifactId: "report-1",
    sessionId: "s-1",
    turnScopeId: "turn-1",
    data: { text: "preserved" },
    operation: "created",
    baseRevision: null,
    revision: 1,
    sequence: 1,
    occurredAt: "2026-10-31T18:00:00.000Z",
  });
}

test("artifact collections preserve their array, event and payload references", () => {
  const events = [artifact()];
  assert.equal(assertSessionArtifactEvents(events, "s-1"), events);
  assert.equal(events[0].payload.data.text, "preserved");
  const empty = [];
  assert.equal(assertSessionArtifactEvents(empty, "s-1"), empty);
});

test("artifact collections reject absent, malformed, foreign and duplicate facts without mutation", () => {
  const valid = artifact();
  const wrongOwner = structuredClone(valid);
  wrongOwner.identity.sessionId = "s-other";
  const badPayload = structuredClone(valid);
  badPayload.payload.revision = 0;
  for (const events of [
    undefined,
    null,
    {},
    [null],
    [{}],
    [wrongOwner],
    [badPayload],
    [valid, valid],
  ]) {
    const before = structuredClone(events);
    assert.throws(() => assertSessionArtifactEvents(events, "s-1"), INVALID);
    assert.deepEqual(events, before);
  }
  for (const eventId of ["", " event-1 ", 1, null]) {
    const event = structuredClone(valid);
    event.identity.eventId = eventId;
    assert.throws(() => assertSessionArtifactEvents([event], "s-1"), INVALID);
  }
  assert.throws(() => assertSessionArtifactEvents([], " s-1 "), INVALID);
});

test("a valid timeline event is rejected from the session artifact collection", () => {
  const event = createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId: "timeline-1",
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "s-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: MESSAGE_EVENT_SEQUENCE_DOMAIN, scopeId: "pm-1", sequence: 1 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-10-31T18:00:00.000Z",
    payload: {
      eventType: "tool_call_start",
      presentationMessageId: "pm-1",
      dialogProcessId: "dialog-1",
      tool: "read_file",
      toolCallId: "call-1",
      args: {},
    },
  });
  assert.equal(validateProtocolEvent(event).valid, true);
  assert.throws(
    () => assertSessionArtifactEvents([event], "s-1"),
    (error) =>
      error.code === INVALID.code && error.protocolErrors.includes("event_not_session_artifact:0"),
  );
});
