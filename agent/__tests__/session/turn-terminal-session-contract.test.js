/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSessionEntity } from "../../src/session/entities/session-entity.js";
import {
  buildSessionDisplaySummary,
  SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION,
} from "../../src/session/session-summary-builders.js";

const now = () => "2026-07-10T00:00:00.000Z";

function terminalLifecycle({
  turnScopeId = "t1",
  dialogProcessId = "dp1",
  state = "completed",
  status = "completed",
  reason = "run_completed",
} = {}) {
  return {
    sequence: 2,
    activeTurnScopeId: "",
    turns: {
      [turnScopeId]: {
        turnScopeId,
        messageId: `${turnScopeId}-event-message`,
        presentationMessageId: `${turnScopeId}-presentation-message`,
        dialogProcessId,
        state,
        sequence: 2,
        revision: 2,
        createdAt: now(),
        updatedAt: now(),
        terminalStatus: {
          turnScopeId,
          dialogProcessId,
          status,
          reason,
          description: status,
          updatedAt: now(),
        },
      },
    },
  };
}

test("message-local lifecycle fields cannot become authoritative terminal facts", () => {
  const session = normalizeSessionEntity(
    {
      sessionId: "s1",
      messages: [
        {
          messageUid: "sm_noncanonical_terminal_user",
          role: "user",
          content: "noncanonical",
          turnScopeId: "t1",
          state: "user_stopped",
          status: "user_stopped",
          channelState: "user_stopped",
          stopState: "user_stopped",
          monotonicState: "monotonic",
        },
      ],
    },
    { now },
  );

  assert.deepEqual(session.turnLifecycle.turns, {});
  const message = session.messages[0];
  for (const key of ["state", "status", "channelState", "stopState", "monotonicState"]) {
    assert.equal(message[key], undefined);
  }
});

test("summary projects only the authoritative lifecycle snapshot", () => {
  const session = normalizeSessionEntity(
    {
      sessionId: "s-lifecycle",
      updatedAt: now(),
      messages: [
        {
          messageUid: "sm_lifecycle_assistant",
          role: "assistant",
          content: "done",
          turnScopeId: "t1",
          dialogProcessId: "dp1",
        },
      ],
      turnLifecycle: terminalLifecycle(),
    },
    { now },
  );

  const summary = buildSessionDisplaySummary(session);
  assert.equal(summary.schemaVersion, SESSION_DISPLAY_SUMMARY_SCHEMA_VERSION);
  assert.equal(summary.turnLifecycleSnapshot.eventType, "turn.snapshot");
  assert.equal(summary.turnLifecycleSnapshot.sessionId, "s-lifecycle");
  assert.equal(summary.turnLifecycleSnapshot.sequence, 2);
  assert.equal(summary.turnLifecycleSnapshot.recentTerminalTurns[0].state, "completed");
  assert.equal(
    summary.turnLifecycleSnapshot.recentTerminalTurns[0].terminalStatus.status,
    "completed",
  );
  assert.ok(summary.turnLifecycleSnapshot.commandId);
});

test("action failure before message persistence remains terminal after summary hydration", () => {
  const session = normalizeSessionEntity(
    {
      sessionId: "s-action-failure",
      updatedAt: now(),
      messages: [],
      turnLifecycle: terminalLifecycle({
        state: "action_failed",
        status: "error",
        reason: "attachment_rejected",
      }),
    },
    { now },
  );

  const summary = buildSessionDisplaySummary(session);
  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0].turnPlaceholder, true);
  assert.equal(summary.messages[0].turnScopeId, "t1");
  assert.equal(summary.turnLifecycleSnapshot.activeTurn, null);
  assert.equal(summary.turnLifecycleSnapshot.recentTerminalTurns.length, 1);
  assert.equal(summary.turnLifecycleSnapshot.recentTerminalTurns[0].state, "action_failed");
  assert.equal(summary.turnLifecycleSnapshot.recentTerminalTurns[0].terminalStatus.status, "error");
});

test("parent and child sessions own independent lifecycle aggregates", () => {
  const parent = normalizeSessionEntity(
    {
      sessionId: "parent",
      turnLifecycle: terminalLifecycle({
        turnScopeId: "parent-turn",
        dialogProcessId: "parent-dialog",
      }),
    },
    { now },
  );
  const child = normalizeSessionEntity(
    {
      sessionId: "child",
      parentSessionId: "parent",
      turnLifecycle: terminalLifecycle({
        turnScopeId: "child-turn",
        dialogProcessId: "child-dialog",
        state: "processing_failed",
        status: "error",
        reason: "run_error",
      }),
    },
    { now },
  );

  assert.deepEqual(Object.keys(parent.turnLifecycle.turns), ["parent-turn"]);
  assert.deepEqual(Object.keys(child.turnLifecycle.turns), ["child-turn"]);
  child.turnLifecycle.turns["child-turn"].terminalStatus.description = "mutated child";
  assert.equal(parent.turnLifecycle.turns["parent-turn"].terminalStatus.description, "completed");
});

test("synthetic placeholders cannot enter persistence or summary", () => {
  const session = normalizeSessionEntity(
    {
      sessionId: "s-placeholder",
      messages: [
        {
          messageUid: "sm_placeholder_assistant",
          role: "assistant",
          content: "本轮异常停止",
          turnScopeId: "t1",
          synthetic: true,
          placeholder: true,
          turnStatusPlaceholder: true,
          turnStatus: { turnScopeId: "t1", status: "error" },
          state: "error",
          status: "error",
        },
      ],
    },
    { now },
  );

  assert.deepEqual(session.turnLifecycle.turns, {});
  const message = session.messages[0];
  for (const key of [
    "synthetic",
    "placeholder",
    "turnStatusPlaceholder",
    "turnStatus",
    "state",
    "status",
  ]) {
    assert.equal(message[key], undefined);
  }
  const summary = buildSessionDisplaySummary(session);
  assert.equal(summary.turnLifecycleSnapshot.sequence, 0);
  assert.equal(summary.messages[0].turnStatusPlaceholder, undefined);
});
