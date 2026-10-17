/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createTurnTerminalStatus,
  materializeTurnTerminalMessages,
  normalizeTurnTerminalStatus,
  projectTurnTerminalStatuses,
} from "../src/lifecycle/turn-terminal.js";

const committed = createTurnTerminalStatus("completed", {
  turnScopeId: "turn-a",
  dialogProcessId: "dialog-a",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("terminal status normalization keeps only the command contract shape", () => {
  assert.deepEqual(normalizeTurnTerminalStatus(committed), committed);
  assert.deepEqual(normalizeTurnTerminalStatus({ ...committed, extra: "x" }), committed);
  assert.deepEqual(
    normalizeTurnTerminalStatus(createTurnTerminalStatus("aborted", { turnScopeId: "t" })),
    createTurnTerminalStatus("aborted", { turnScopeId: "t" }),
  );
});

test("terminal status normalization rejects non-protocol shapes", () => {
  assert.equal(normalizeTurnTerminalStatus(null), null);
  assert.equal(normalizeTurnTerminalStatus({ status: "completed" }), null);
  assert.equal(normalizeTurnTerminalStatus({ ...committed, turnScopeId: "" }), null);
  assert.equal(normalizeTurnTerminalStatus({ ...committed, reason: "user_stop" }), null);
  assert.equal(
    normalizeTurnTerminalStatus({ ...committed, command: "completed", status: "" }),
    null,
  );
});

test("terminal status projection reads only protocol-shaped turn.terminalStatus", () => {
  const statuses = projectTurnTerminalStatuses({
    turns: {
      "turn-a": { turnScopeId: "turn-a", state: "completed", terminalStatus: committed },
      "turn-b": { turnScopeId: "turn-b", state: "processing_failed", failure: { code: "x" } },
      "turn-c": { turnScopeId: "turn-c", state: "processing" },
      "turn-d": {
        turnScopeId: "turn-d",
        state: "completed",
        terminalStatus: { status: "completed" },
      },
    },
  });
  assert.deepEqual(statuses, [committed]);
});

test("terminal materialization rejects non-protocol terminal status", () => {
  const rejected = materializeTurnTerminalMessages({
    messages: [],
    terminalStatus: { turnScopeId: "turn-a", status: "completed" },
  });
  assert.equal(rejected.materialized, false);
  assert.equal(rejected.reason, "invalid_turn_terminal_status");
  const accepted = materializeTurnTerminalMessages({ messages: [], terminalStatus: committed });
  assert.equal(accepted.materialized, true);
  assert.equal(accepted.terminalStatus, committed);
});
