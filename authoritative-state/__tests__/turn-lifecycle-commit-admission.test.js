/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE } from "@noobot/session-protocol/turn-lifecycle";
import { commitTurnLifecycle } from "../src/application/commit-turn-lifecycle.js";

test("turn lifecycle commit rejects events without causationId", () => {
  const result = commitTurnLifecycle({
    parentSessionId: "",
    lifecycle: {},
    event: {
      eventType: TURN_EVENT.ACTION_ACCEPTED,
      startedAt: "2026-07-18T00:00:00.000Z",
      commandId: "missing-causation-command",
      userId: "user-1",
      sessionId: "session-1",
      turnScopeId: "turn-1",
      presentationMessageId: "presentation-1",
      action: "send",
      phase: TURN_PHASE.ACTION,
      expectedRevision: 0,
    },
    createEventId: () => "missing-causation-event",
    now: () => "2026-07-18T00:00:00.000Z",
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "invalid_lifecycle_identity");
});

test("turn lifecycle commit rejects a terminal event without an explicit terminalStatus", () => {
  for (const eventType of [TURN_EVENT.COMPLETED, TURN_EVENT.STOP_COMPLETED, TURN_EVENT.FAILED]) {
    const lifecycle = {};
    const result = commitTurnLifecycle({
      parentSessionId: "",
      lifecycle,
      event: {
        eventType,
        commandId: `terminal-${eventType}`,
        causationId: `terminal-${eventType}`,
        userId: "user-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        phase: TURN_PHASE.PROCESSING,
        failure: { code: "turn_failed", message: "turn failed", retryable: false },
      },
      materializeTerminal: () => assert.fail("materializer must not run"),
      createEventId: () => "terminal-event",
      now: () => "2026-07-18T00:00:00.000Z",
    });
    assert.deepEqual(result, {
      applied: false,
      reason: "missing_turn_terminal_status",
      lifecycle,
    });
  }
});

test("turn lifecycle commit rejects terminalStatus on a retryable finalize failure", () => {
  for (const phase of [TURN_PHASE.COMPLETION, TURN_PHASE.STOP]) {
    const lifecycle = {};
    const result = commitTurnLifecycle({
      parentSessionId: "",
      lifecycle,
      event: {
        eventType: TURN_EVENT.FAILED,
        commandId: `retryable-${phase}`,
        causationId: `retryable-${phase}`,
        userId: "user-1",
        sessionId: "session-1",
        turnScopeId: "turn-1",
        phase,
        failure: { code: "finalize_failed", message: "finalize failed", retryable: true },
        terminalStatus: { command: "error" },
      },
      materializeTerminal: () => assert.fail("materializer must not run"),
      createEventId: () => "retryable-event",
      now: () => "2026-07-18T00:00:00.000Z",
    });
    assert.deepEqual(result, {
      applied: false,
      reason: "unexpected_turn_terminal_status",
      lifecycle,
    });
  }
});
