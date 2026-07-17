/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTurnTerminalCommand,
  normalizeTurnStatusEntity,
  upsertTurnStatusEntity,
} from "../../../src/system-core/session/entities/turn-status-entity.js";

const now = () => "2026-07-10T00:00:00.000Z";

test("turn status accepts only the canonical contract", () => {
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", state: "completed" }, now), null);
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", channelState: "completed" }, now), null);
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", status: "done" }, now), null);
  assert.deepEqual(normalizeTurnStatusEntity({
    turnScopeId: "t1",
    status: " COMPLETED ",
    reason: "run_completed",
  }, now), {
    turnScopeId: "t1",
    status: "completed",
    reason: "run_completed",
    updatedAt: now(),
    createdAt: now(),
  });
});

test("turn status bridges identities through persisted messages", () => {
  const result = upsertTurnStatusEntity({
    statuses: [],
    messages: [{ turnScopeId: "t1", dialogProcessId: "d1" }],
    incoming: { turnScopeId: "t1", status: "user_stopped", reason: "user_stop" },
    now,
  });
  assert.equal(result.changed, true);
  assert.equal(result.turnStatus.turnScopeId, "t1");
  assert.equal(result.turnStatus.dialogProcessId, "d1");
  assert.equal(result.statuses.length, 1);
});

test("same terminal status is idempotent and conflicting terminal status cannot overwrite it", () => {
  const existing = {
    turnScopeId: "t1",
    dialogProcessId: "d1",
    status: "user_stopped",
    reason: "user_stop",
    createdAt: now(),
    updatedAt: now(),
  };
  const retry = upsertTurnStatusEntity({
    statuses: [existing],
    incoming: { dialogProcessId: "d1", status: "user_stopped", reason: "user_stop", updatedAt: now() },
    now,
  });
  assert.equal(retry.changed, false);
  assert.equal(retry.statuses.length, 1);

  const conflict = upsertTurnStatusEntity({
    statuses: retry.statuses,
    incoming: { turnScopeId: "t1", status: "completed", reason: "run_completed" },
    now,
  });
  assert.equal(conflict.changed, false);
  assert.equal(conflict.turnStatus.status, "user_stopped");
  assert.deepEqual(conflict.statuses, retry.statuses);
});

test("terminal commands own canonical status and reason combinations", () => {
  const cases = [
    ["completed", "completed", "run_completed"],
    ["user_stopped", "user_stopped", "user_stop"],
    ["error", "error", "run_error"],
    ["aborted", "error", "run_aborted"],
    ["timeout", "timeout", "run_timeout"],
  ];
  for (const [command, status, reason] of cases) {
    const result = buildTurnTerminalCommand(command, { turnScopeId: "t1" });
    assert.equal(result.status, status);
    assert.equal(result.reason, reason);
  }
  assert.equal(buildTurnTerminalCommand("unknown", { turnScopeId: "t1" }), null);
});

test("status and reason must form a canonical pair", () => {
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", status: "completed" }, now), null);
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", status: "completed", reason: "run_timeout" }, now), null);
  assert.equal(normalizeTurnStatusEntity({ turnScopeId: "t1", status: "error", reason: "unknown" }, now), null);
  assert.equal(
    normalizeTurnStatusEntity({ turnScopeId: "t1", status: " ERROR ", reason: " RUN_ABORTED " }, now)?.reason,
    "run_aborted",
  );
});
