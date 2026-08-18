/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/session-protocol/turn-lifecycle";
import { recoverOrphanedTurn, recoverTurnFinalize } from "../src/application/recovery-policy.js";

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

const conflictFor = (turn) => ({
  reason: "session_action_conflict",
  lifecycle: {
    activeTurnScopeId: turn.turnScopeId,
    turns: { [turn.turnScopeId]: turn },
  },
});

test("orphan recovery leaves a live execution authoritative turn untouched", async () => {
  let commits = 0;
  const result = await recoverOrphanedTurn({
    conflict: conflictFor(staleTurn()),
    identity: { userId: "u1", sessionId: "s1" },
    inspectExecution: async () => ({
      alive: true,
      observedAtMs: Date.parse("2026-07-18T00:01:00.000Z"),
    }),
    commitTurnLifecycle: async () => {
      commits += 1;
      return { applied: true };
    },
    graceMs: 1,
  });
  assert.deepEqual(result, { recovered: false, reason: "execution_alive" });
  assert.equal(commits, 0);
});

test("orphan recovery respects the authority grace period", async () => {
  let commits = 0;
  const result = await recoverOrphanedTurn({
    conflict: conflictFor(staleTurn()),
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
  assert.deepEqual(result, { recovered: false, reason: "orphan_grace_period" });
  assert.equal(commits, 0);
});

test("orphan recovery binds failure to the observed revision", async () => {
  let command = null;
  const result = await recoverOrphanedTurn({
    conflict: conflictFor(staleTurn()),
    identity: { userId: "u1", sessionId: "s1", parentSessionId: "parent" },
    inspectExecution: async () => ({
      alive: false,
      observedAtMs: Date.parse("2026-07-18T00:01:00.000Z"),
    }),
    commitTurnLifecycle: async (input) => {
      command = input;
      return { applied: false, reason: "turn_revision_conflict" };
    },
    graceMs: 1,
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "turn_revision_conflict");
  assert.equal(command.expectedRevision, 3);
  assert.equal(command.commandId, "orphaned:turn-stale:failed:processing:r3");
  assert.equal(command.failure.code, "service_restart_orphaned_turn");
});

test("finalize recovery constructs one revision-bound authority command", async () => {
  const turn = staleTurn({
    state: TURN_STATE.COMPLETION_REQUESTING,
    phase: TURN_PHASE.COMPLETION,
    finalizeIntent: { type: "completion", commandId: "stable-finalize", retryable: true },
  });
  let activeTurn = turn;
  const commands = [];
  const result = await recoverTurnFinalize({
    userId: "u1",
    sessionId: "s1",
    commandId: "recover-request",
    readSnapshot: async () => ({ found: true, snapshot: { activeTurn } }),
    commitTurnLifecycle: async (input) => {
      commands.push(input);
      activeTurn = null;
      return { applied: true, turn: { ...turn, state: TURN_STATE.COMPLETED, revision: 4 } };
    },
  });
  assert.equal(result.recovered, true);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].eventType, TURN_EVENT.COMPLETED);
  assert.equal(commands[0].expectedRevision, 3);
  assert.equal(commands[0].commandId, "stable-finalize");
});

test("stop finalize recovery carries the pending assistant into terminal materialization", async () => {
  const turn = staleTurn({
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
  });
  let command;
  const result = await recoverTurnFinalize({
    userId: "u1",
    sessionId: "s1",
    readSnapshot: async () => ({ found: true, snapshot: { activeTurn: turn } }),
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
  const turn = staleTurn({
    state: TURN_STATE.STOPPING,
    phase: TURN_PHASE.STOP,
    finalizeIntent: { type: "stop", commandId: "stable-stop-finalize", retryable: true },
  });
  let commits = 0;
  const result = await recoverTurnFinalize({
    userId: "u1",
    sessionId: "s1",
    readSnapshot: async () => ({ found: true, snapshot: { activeTurn: turn } }),
    commitTurnLifecycle: async () => {
      commits += 1;
      return { applied: false, reason: "turn_revision_conflict", currentRevision: 4 };
    },
  });
  assert.equal(result.recovered, false);
  assert.equal(result.reason, "turn_revision_conflict");
  assert.equal(commits, 1);
});
