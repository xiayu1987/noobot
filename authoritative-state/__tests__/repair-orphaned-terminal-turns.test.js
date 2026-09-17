/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { repairOrphanedTerminalTurns } from "../src/application/repair-orphaned-terminal-turns.js";

const terminalStatus = (turnScopeId) => ({
  turnScopeId,
  dialogProcessId: `${turnScopeId}-dialog`,
  status: "user_stopped",
  reason: "user_stop",
  description: "对话已被用户停止",
});

test("repair drops terminal lifecycle turns whose canonical messages are gone", () => {
  const repair = repairOrphanedTerminalTurns({
    messages: [{ turnScopeId: "kept", dialogProcessId: "kept-dialog", role: "user" }],
    turnLifecycle: {
      activeTurnScopeId: "orphan",
      sequence: 7,
      turns: {
        kept: {
          turnScopeId: "kept",
          dialogProcessId: "kept-dialog",
          state: "completed",
          terminalStatus: terminalStatus("kept"),
          continuedByTurnScopeId: "orphan",
        },
        orphan: {
          turnScopeId: "orphan",
          dialogProcessId: "orphan-dialog",
          state: "stop_completed",
          terminalStatus: terminalStatus("orphan"),
        },
      },
    },
  });

  assert.equal(repair.repaired, true);
  assert.deepEqual(repair.orphanedTurnScopeIds, ["orphan"]);
  assert.deepEqual(Object.keys(repair.turnLifecycle.turns), ["kept"]);
  assert.equal(repair.turnLifecycle.turns.kept.continuedByTurnScopeId, "");
  assert.equal(repair.turnLifecycle.activeTurnScopeId, "");
  assert.equal(repair.turnLifecycle.sequence, 7);
});

test("repair clears a survivor's continuationSource pointing at a dropped turn", () => {
  const repair = repairOrphanedTerminalTurns({
    messages: [{ turnScopeId: "survivor", dialogProcessId: "survivor-dialog", role: "user" }],
    turnLifecycle: {
      turns: {
        survivor: {
          turnScopeId: "survivor",
          dialogProcessId: "survivor-dialog",
          state: "completed",
          continuationSource: { turnScopeId: "orphan", dialogProcessId: "orphan-dialog" },
        },
        orphan: {
          turnScopeId: "orphan",
          dialogProcessId: "orphan-dialog",
          state: "stop_completed",
          terminalStatus: terminalStatus("orphan"),
        },
      },
    },
  });

  assert.equal(repair.repaired, true);
  assert.deepEqual(Object.keys(repair.turnLifecycle.turns), ["survivor"]);
  assert.equal(repair.turnLifecycle.turns.survivor.continuationSource, null);
});

test("repair keeps a healthy lifecycle untouched", () => {
  const turnLifecycle = {
    activeTurnScopeId: "live",
    turns: {
      live: {
        turnScopeId: "live",
        dialogProcessId: "live-dialog",
        state: "completed",
        terminalStatus: terminalStatus("live"),
      },
    },
  };
  const repair = repairOrphanedTerminalTurns({
    messages: [{ turnScopeId: "live", dialogProcessId: "live-dialog", role: "user" }],
    turnLifecycle,
  });

  assert.equal(repair.repaired, false);
  assert.deepEqual(repair.orphanedTurnScopeIds, []);
  assert.equal(repair.turnLifecycle, turnLifecycle);
});

test("repair leaves in-flight turns without a terminalStatus in place", () => {
  const repair = repairOrphanedTerminalTurns({
    messages: [],
    turnLifecycle: {
      activeTurnScopeId: "running",
      turns: {
        running: { turnScopeId: "running", dialogProcessId: "running-dialog", state: "processing" },
      },
    },
  });

  assert.equal(repair.repaired, false);
  assert.deepEqual(Object.keys(repair.turnLifecycle.turns), ["running"]);
  assert.equal(repair.turnLifecycle.activeTurnScopeId, "running");
});
