/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeTurnLifecycleEvents } from "@noobot/event-protocol";
import { ChannelManager } from "../../src/channel/channel-manager.js";
import { createChannelKey } from "../../src/shared/utils.js";
import { authoritativeLifecycle } from "./channel-manager.state-consistency.reconnect.fixtures.js";

const sessionId = "window-session";
const event = (overrides = {}) =>
  authoritativeLifecycle({
    sessionId,
    turnScopeId: "window-turn",
    eventId: "window-event",
    eventType: "turn.processing_started",
    occurredAt: "2026-01-01T00:00:00.000Z",
    sequence: 1,
    revision: 1,
    ...overrides,
  });

function setup() {
  const manager = new ChannelManager({ OPEN: 1 });
  const channel = manager.ensureChannel(createChannelKey({ userId: "window-user", sessionId }), {
    userId: "window-user",
    sessionId,
  });
  return { manager, channel };
}

test("lifecycle merge preserves references, sorts, and accepts only identical redelivery", () => {
  const first = event();
  const second = event({ eventId: "next", sequence: 2, revision: 2 });
  const source = [second, first, structuredClone(first)];
  const before = structuredClone(source);
  const merged = mergeTurnLifecycleEvents(sessionId, source);
  assert.deepEqual(merged, [first, second]);
  assert.equal(merged[0], first);
  assert.deepEqual(source, before);
  for (const conflict of [
    event({ eventId: "different" }),
    event({ sequence: 2, revision: 2 }),
    event({ revision: 2 }),
  ]) {
    assert.throws(
      () => mergeTurnLifecycleEvents(sessionId, [first, conflict]),
      /lifecycle_event_conflict/,
    );
  }
  assert.throws(
    () => mergeTurnLifecycleEvents("other-session", [first]),
    /invalid lifecycle merge/,
  );
  assert.throws(() => mergeTurnLifecycleEvents(sessionId, [null]), /invalid lifecycle merge/);
});

test("single and cross-channel windows reject conflicts without rewriting state", () => {
  const { manager, channel } = setup();
  const first = event();
  manager.recordTurnLifecycleEnvelope(channel, first);
  const before = channel.lifecycleWindowsBySessionId.get(sessionId);
  const conflict = event({ eventId: "other-event", revision: 2 });
  assert.throws(
    () => manager.recordTurnLifecycleEnvelope(channel, conflict),
    /lifecycle_event_conflict/,
  );
  assert.equal(channel.lifecycleWindowsBySessionId.get(sessionId), before);
  const other = { lifecycleWindowsBySessionId: new Map([[sessionId, [conflict]]]) };
  assert.throws(
    () => manager.getTurnLifecycleReplayForChannels([channel, other], sessionId, 0),
    /lifecycle_event_conflict/,
  );
  assert.throws(
    () => manager.hasActiveTurnLifecycleForChannels([channel, other], sessionId),
    /lifecycle_event_conflict/,
  );
  const duplicate = {
    lifecycleWindowsBySessionId: new Map([[sessionId, [structuredClone(first)]]]),
  };
  assert.deepEqual(
    manager.getTurnLifecycleReplayForChannels([channel, duplicate], sessionId, 0).events,
    [first],
  );
});
