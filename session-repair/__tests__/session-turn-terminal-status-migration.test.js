/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  TURN_ORPHAN_RECOVERY,
  TURN_TERMINAL_FIXED_DESCRIPTION,
  normalizeTurnTerminalStatus,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";

import { releasedSession } from "./helpers/released-session.js";

function migrateReleased(fields) {
  return migrateSessionDocument(releasedSession(fields));
}
const turnScopeId = "turn-orphaned";
const finishedAt = "2026-10-11T10:22:52.927Z";

function sessionWith(turn, schemaVersion = 9) {
  return {
    schemaVersion,
    sessionId: "session-1",
    aggregateVersion: 0,
    messages: [],
    turnLifecycle: { turns: { [turnScopeId]: { turnScopeId, ...turn } } },
  };
}

function orphanedTurn(extra = {}) {
  return {
    dialogProcessId: "dialog-1",
    state: "processing_failed",
    phase: "processing",
    finishedAt,
    failure: { ...TURN_ORPHAN_RECOVERY.failure },
    terminalStatus: { turnScopeId, status: "processing_failed", updatedAt: finishedAt },
    ...extra,
  };
}

function migrationErrorCode(source) {
  try {
    migrateReleased(source);
  } catch (error) {
    return error.code;
  }
  return "";
}

test("v10 migration rebuilds an orphan recovery terminalStatus from the protocol constant", () => {
  const result = migrateReleased(sessionWith(orphanedTurn()));
  const terminalStatus = result.document.turnLifecycle.turns[turnScopeId].terminalStatus;
  assert.equal(result.document.schemaVersion, SESSION_ARTIFACT_SCHEMA_VERSION);
  assert.ok(result.migrations.includes("turn-terminal-status-protocol-v1"));
  assert.deepEqual(terminalStatus, {
    turnScopeId,
    status: "error",
    reason: "run_error",
    description: TURN_ORPHAN_RECOVERY.failure.message,
    updatedAt: finishedAt,
    dialogProcessId: "dialog-1",
  });
  assert.deepEqual(normalizeTurnTerminalStatus(terminalStatus), terminalStatus);
});

test("v10 migration keeps protocol terminal statuses unchanged", () => {
  const terminalStatus = {
    turnScopeId,
    status: "completed",
    reason: "run_completed",
    description: "",
    updatedAt: finishedAt,
  };
  const result = migrateReleased(
    sessionWith({ state: "completed", terminalStatus, failure: null }),
  );
  assert.deepEqual(result.document.turnLifecycle.turns[turnScopeId].terminalStatus, terminalStatus);
  assert.equal(result.migrations.includes("turn-terminal-status-protocol-v1"), false);
});

test("v10 migration rejects a non-protocol terminalStatus without an orphan recovery failure", () => {
  for (const failure of [
    null,
    { ...TURN_ORPHAN_RECOVERY.failure, message: "other message" },
    { ...TURN_ORPHAN_RECOVERY.failure, retryable: true },
    { ...TURN_ORPHAN_RECOVERY.failure, code: "turn_failed" },
  ]) {
    assert.equal(
      migrationErrorCode(sessionWith(orphanedTurn({ failure }))),
      "SESSION_TURN_TERMINAL_STATUS_UNMIGRATABLE",
    );
  }
});

test("v10 migration does not run for documents already at the current schema", () => {
  const source = sessionWith(orphanedTurn(), SESSION_ARTIFACT_SCHEMA_VERSION);
  const result = migrateReleased(source);
  assert.deepEqual(
    result.document.turnLifecycle.turns[turnScopeId].terminalStatus,
    source.turnLifecycle.turns[turnScopeId].terminalStatus,
  );
});

function terminalTurn(terminalStatus) {
  return { dialogProcessId: "dialog-1", state: "stop_completed", finishedAt, terminalStatus };
}

function v13Terminal(command, extra = {}) {
  return {
    turnScopeId,
    status: command,
    reason: command === "user_stopped" ? "user_stop" : "run_error",
    description: "",
    updatedAt: finishedAt,
    dialogProcessId: "dialog-1",
    ...extra,
  };
}

test("v14 migration rebuilds empty user_stopped description from the protocol constant", () => {
  const result = migrateReleased(sessionWith(terminalTurn(v13Terminal("user_stopped")), 13));
  const terminalStatus = result.document.turnLifecycle.turns[turnScopeId].terminalStatus;
  assert.ok(result.migrations.includes("turn-terminal-description-v14"));
  assert.equal(terminalStatus.description, TURN_TERMINAL_FIXED_DESCRIPTION.user_stopped);
  assert.deepEqual(normalizeTurnTerminalStatus(terminalStatus), terminalStatus);
});

test("v14 migration clears a completed terminal description", () => {
  const status = {
    ...v13Terminal("completed", { reason: "run_completed" }),
    description: "done",
  };
  const result = migrateReleased(sessionWith(terminalTurn(status), 13));
  assert.equal(result.document.turnLifecycle.turns[turnScopeId].terminalStatus.description, "");
});

test("v14 migration rejects an error terminal without its producer description", () => {
  assert.equal(
    migrationErrorCode(sessionWith(terminalTurn(v13Terminal("error")), 13)),
    "SESSION_TURN_TERMINAL_STATUS_UNMIGRATABLE",
  );
});
