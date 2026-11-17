/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEventEnvelope, EVENT_FAMILY, getEventFamily } from "@noobot/event-protocol";
import { MESSAGE_EVENT_TYPE, MESSAGE_EVENT_WIRE_EVENT } from "@noobot/event-protocol/message-event";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";
import { initializeCurrentTurnMessageEventProjection } from "../../src/events/current-turn-message-event-projection.js";

function delta(eventId, modelMessageId, text) {
  return createEventEnvelope({
    family: EVENT_FAMILY.MESSAGE_TIMELINE,
    schemaVersion: getEventFamily(EVENT_FAMILY.MESSAGE_TIMELINE).schemaVersion,
    identity: {
      eventId,
      eventType: MESSAGE_EVENT_WIRE_EVENT,
      sessionId: "session-1",
      turnScopeId: "turn-1",
    },
    causality: {},
    ordering: { domain: "message-event", scopeId: "presentation-1", sequence: 0 },
    producer: { type: "agent", id: "agent-1" },
    occurredAt: "2026-09-05T03:39:00.000Z",
    payload: {
      eventType: MESSAGE_EVENT_TYPE.ACTIVITY_DELTA,
      activityEventType: MESSAGE_EVENT_TYPE.THINKING,
      activityId: `activity-${modelMessageId}`,
      activityKind: "guidance_analysis",
      presentationMessageId: "presentation-1",
      dialogProcessId: "dialog-1",
      modelMessageId,
      text,
    },
  });
}

function runtime() {
  return initializeCurrentTurnMessageEventProjection({
    currentTurnMessages: createCurrentTurnMessagesStore([]),
    persistCurrentTurnMessages: async () => assert.fail("pending fragments must not persist"),
  });
}

for (const count of [64, 1024]) {
  test(`enqueueing ${count} pending fragments does not revisit previous event identities`, async () => {
    const projection = runtime();
    let reads = 0;
    for (let index = 0; index < count; index += 1) {
      const envelope = delta(`delta-${index}`, "model-1", `${index},`);
      const observed = {
        ...envelope,
        get identity() {
          reads += 1;
          return envelope.identity;
        },
      };
      await projection.projectCurrentTurnMessageEvent(observed);
    }
    assert.equal(reads, count);
    const result = projection.materializePendingCurrentTurnMessageEvents({
      modelMessageId: "model-1",
    });
    assert.equal(result.activityTimeline.length, 1);
    assert.equal(
      result.activityTimeline[0].text,
      Array.from({ length: count }, (_, i) => `${i},`).join(""),
    );
    assert.deepEqual(
      projection.materializePendingCurrentTurnMessageEvents({ modelMessageId: "model-1" }),
      {
        activityTimeline: [],
        toolTimeline: [],
      },
    );
  });
}

test("pending fragments preserve arrival order, first delivery and separate model ownership", async () => {
  const projection = runtime();
  for (const envelope of [
    delta("a1", "model-a", "A"),
    delta("b1", "model-b", "B"),
    delta("a1", "model-a", "duplicate"),
    delta("unowned", "", "U"),
    delta("a2", "model-a", "🙂"),
    delta("b2", "model-b", "2"),
  ])
    await projection.projectCurrentTurnMessageEvent(envelope);
  assert.equal(
    projection.materializeUnownedCurrentTurnMessageEvents().activityTimeline[0].text,
    "U",
  );
  assert.equal(
    projection.materializePendingCurrentTurnMessageEvents({ modelMessageId: "model-a" })
      .activityTimeline[0].text,
    "A🙂",
  );
  assert.equal(
    projection.materializePendingCurrentTurnMessageEvents({ modelMessageId: "model-b" })
      .activityTimeline[0].text,
    "B2",
  );
  assert.deepEqual(projection.materializeUnownedCurrentTurnMessageEvents(), {
    activityTimeline: [],
    toolTimeline: [],
  });
});
