/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_RECOVERY_ACTION,
  TURN_STATE,
} from "@noobot/session-protocol/turn-lifecycle";
import {
  assessTurnRecovery,
  inspectTurnRecovery,
  recoverActiveTurn,
} from "../src/application/recovery-policy.js";

const OBSERVED_LATE = Date.parse("2026-07-18T00:01:00.000Z");

const staleTurn = (overrides = {}) => ({
  turnScopeId: "turn-stale",
  dialogProcessId: "dialog-stale",
  executionId: "agent:turn-stale",
  state: TURN_STATE.PROCESSING,
  phase: TURN_PHASE.PROCESSING,
  revision: 3,
  updatedAt: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

const dead = async () => ({ alive: false, observedAtMs: OBSERVED_LATE });

test("assessment is pure: finalize wins over liveness, orphan needs a dead observation", () => {
  const finalizeTurn = staleTurn({
    state: TURN_STATE.COMPLETION_REQUESTING,
    finalizeIntent: { type: "completion", retryable: true },
  });
  assert.equal(
    assessTurnRecovery({ turn: finalizeTurn, observation: { alive: true } }).action,
    TURN_RECOVERY_ACTION.FINALIZE,
  );
  assert.deepEqual(assessTurnRecovery({ turn: null }), {
    action: TURN_RECOVERY_ACTION.NONE,
    reason: "no_active_turn",
  });
  assert.equal(assessTurnRecovery({ turn: staleTurn() }).reason, "execution_liveness_unavailable");
  assert.equal(
    assessTurnRecovery({
      turn: staleTurn(),
      observation: { alive: false, observedAtMs: OBSERVED_LATE },
      graceMs: 1,
    }).action,
    TURN_RECOVERY_ACTION.ORPHAN,
  );
});

test("inspection observes liveness only when the decision depends on it", async () => {
  let inspections = 0;
  const inspectExecution = async (input) => {
    inspections += 1;
    assert.equal(input.turnScopeId, "turn-stale");
    assert.equal(input.userId, "u1");
    return { alive: false, observedAtMs: OBSERVED_LATE };
  };
  const finalize = await inspectTurnRecovery({
    turn: staleTurn({
      state: TURN_STATE.STOPPING,
      finalizeIntent: { type: "stop", retryable: true },
    }),
    identity: { userId: "u1" },
    inspectExecution,
  });
  assert.equal(finalize.action, TURN_RECOVERY_ACTION.FINALIZE);
  assert.equal(inspections, 0);
  const orphan = await inspectTurnRecovery({
    turn: staleTurn(),
    identity: { userId: "u1" },
    inspectExecution,
    graceMs: 1,
  });
  assert.equal(orphan.action, TURN_RECOVERY_ACTION.ORPHAN);
  assert.equal(inspections, 1);
});

test("orphan recovery leaves a live execution authoritative turn untouched", async () => {
  let commits = 0;
  const result = await recoverActiveTurn({
    turn: staleTurn(),
    identity: { userId: "u1", sessionId: "s1" },
    inspectExecution: async () => ({ alive: true, observedAtMs: OBSERVED_LATE }),
    commitTurnLifecycle: async () => {
      commits += 1;
      return { applied: true };
    },
    graceMs: 1,
  });
  assert.deepEqual(result, {
    recovered: false,
    action: TURN_RECOVERY_ACTION.NONE,
    reason: "execution_alive",
  });
  assert.equal(commits, 0);
});

test("orphan recovery respects the authority grace period", async () => {
  let commits = 0;
  const result = await recoverActiveTurn({
    turn: staleTurn(),
    identity: { userId: "u1", sessionId: "s1" },
    inspectExecution: async () => ({
      alive: false,
      observedAtMs: Date.parse("2026-07-18T00:00:05.000Z"),
    }),
    commitTurnLifecycle: async () => {
      commits += 1;
      return { applied: true };
    },
    graceMs: 10_000,
  });
  assert.deepEqual(result, {
    recovered: false,
    action: TURN_RECOVERY_ACTION.NONE,
    reason: "orphan_grace_period",
  });
  assert.equal(commits, 0);
});

test("orphan recovery binds failure to the observed revision", async () => {
  let command = null;
  const result = await recoverActiveTurn({
    turn: staleTurn(),
    identity: { userId: "u1", sessionId: "s1", parentSessionId: "parent" },
    inspectExecution: dead,
    commitTurnLifecycle: async (input) => {
      command = input;
      return { applied: false, reason: "turn_revision_conflict" };
    },
    graceMs: 1,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.action, TURN_RECOVERY_ACTION.ORPHAN);
  assert.equal(result.reason, "turn_revision_conflict");
  assert.equal(command.expectedRevision, 3);
  assert.equal(command.parentSessionId, "parent");
  assert.equal(command.commandId, "orphaned:turn-stale:failed:processing:r3");
  assert.equal(command.failure.code, "service_restart_orphaned_turn");
});

test("finalize recovery constructs one revision-bound authority command", async () => {
  const commands = [];
  const result = await recoverActiveTurn({
    turn: staleTurn({
      state: TURN_STATE.COMPLETION_REQUESTING,
      phase: TURN_PHASE.COMPLETION,
      finalizeIntent: { type: "completion", commandId: "stable-finalize", retryable: true },
    }),
    identity: { userId: "u1", sessionId: "s1" },
    commitTurnLifecycle: async (input) => {
      commands.push(input);
      return { applied: true };
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(result.action, TURN_RECOVERY_ACTION.FINALIZE);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].eventType, TURN_EVENT.COMPLETED);
  assert.equal(commands[0].expectedRevision, 3);
  assert.equal(commands[0].commandId, "stable-finalize");
});

test("finalize recovery takes priority over orphan failure for a dead completion turn", async () => {
  let command;
  const result = await recoverActiveTurn({
    turn: staleTurn({
      state: TURN_STATE.COMPLETION_REQUESTING,
      phase: TURN_PHASE.COMPLETION,
      finalizeIntent: { type: "completion", commandId: "stable-finalize", retryable: true },
    }),
    identity: { userId: "u1", sessionId: "s1" },
    inspectExecution: dead,
    commitTurnLifecycle: async (input) => {
      command = input;
      return { applied: true };
    },
    graceMs: 1,
  });
  assert.equal(result.action, TURN_RECOVERY_ACTION.FINALIZE);
  assert.equal(command.eventType, TURN_EVENT.COMPLETED);
});

test("stop finalize recovery carries the pending assistant into terminal materialization", async () => {
  let command;
  const result = await recoverActiveTurn({
    turn: staleTurn({
      state: TURN_STATE.STOPPING,
      phase: TURN_PHASE.STOP,
      finalizeIntent: {
        type: "stop",
        commandId: "stable-stop-finalize",
        retryable: true,
        payload: {
          assistantMessage: {
            role: "assistant",
            content: "partial",
            turnScopeId: "turn-stale",
            dialogProcessId: "dialog-stale",
          },
        },
      },
    }),
    identity: { userId: "u1", sessionId: "s1" },
    commitTurnLifecycle: async (input) => {
      command = input;
      return { applied: true };
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(command.eventType, TURN_EVENT.STOP_COMPLETED);
  assert.equal(command.terminalStatus.assistantMessage.content, "partial");
});

test("finalize recovery exposes revision races without retrying a stale decision", async () => {
  let commits = 0;
  const result = await recoverActiveTurn({
    turn: staleTurn({
      state: TURN_STATE.STOPPING,
      phase: TURN_PHASE.STOP,
      finalizeIntent: { type: "stop", commandId: "stable-stop-finalize", retryable: true },
    }),
    identity: { userId: "u1", sessionId: "s1" },
    commitTurnLifecycle: async () => {
      commits += 1;
      return { applied: false, reason: "turn_revision_conflict", currentRevision: 4 };
    },
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "turn_revision_conflict");
  assert.equal(commits, 1);
});

test("recovery reports a missing commit port without committing", async () => {
  const result = await recoverActiveTurn({
    turn: staleTurn(),
    inspectExecution: dead,
    graceMs: 1,
  });
  assert.deepEqual(result, {
    recovered: false,
    action: TURN_RECOVERY_ACTION.ORPHAN,
    reason: "lifecycle_commit_unavailable",
  });
});
