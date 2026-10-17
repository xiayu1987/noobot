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
  normalizeTurnTerminalStatus,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";

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
    migrateSessionDocument(source);
  } catch (error) {
    return error.code;
  }
  return "";
}

test("v10 migration rebuilds an orphan recovery terminalStatus from the protocol constant", () => {
  const result = migrateSessionDocument(sessionWith(orphanedTurn()));
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
  const result = migrateSessionDocument(
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
  const result = migrateSessionDocument(source);
  assert.deepEqual(
    result.document.turnLifecycle.turns[turnScopeId].terminalStatus,
    source.turnLifecycle.turns[turnScopeId].terminalStatus,
  );
});
