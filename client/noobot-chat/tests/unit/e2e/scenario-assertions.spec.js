/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect, it } from "vitest";
import { assertTurnLifecycle } from "../../e2e/protocol/helpers/scenario-assertions.js";
import { TURN_LIFECYCLE_PROTOCOL_VERSION } from "@noobot/session-protocol";

it("waits for the terminal browser receipt after observing the lifecycle event", async () => {
  const event = {
    protocolVersion: TURN_LIFECYCLE_PROTOCOL_VERSION,
    eventType: "turn.stop_completed",
    eventId: "terminal-event",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    sequence: 1,
    revision: 1,
  };
  const receipt = {
    action: "turn.lifecycle.received",
    protocolVersion: 1,
    eventId: event.eventId,
    sessionId: event.sessionId,
    turnScopeId: event.turnScopeId,
  };
  const capture = {
    websocketReceived: [{ payload: JSON.stringify(event) }],
    websocketSent: [{ payload: JSON.stringify({ ...receipt, turnScopeId: "another-turn" }) }],
  };
  let resolved = false;
  const pending = assertTurnLifecycle(capture, event.sessionId, event.turnScopeId).then(
    (events) => {
      resolved = true;
      return events;
    },
  );
  await Promise.resolve();
  expect(resolved).toBe(false);
  capture.websocketSent.push({ payload: JSON.stringify(receipt) });
  await expect(pending).resolves.toEqual([event]);
});
