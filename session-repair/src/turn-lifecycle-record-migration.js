/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  assertTurnLifecycleRecordIntegrity,
  collectTurnRecordErrors,
  isSettledTurn,
  SESSION_ARTIFACT_TURN_LIFECYCLE_RECORD_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { isPlainObject } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

function recordMigrationError(reason, cause) {
  return Object.assign(
    new TypeError(`Session lifecycle record cannot be migrated: ${reason}`, { cause }),
    {
      code: SESSION_REPAIR_ERROR_CODE.TURN_LIFECYCLE_RECORD_UNMIGRATABLE,
      details: { reason },
    },
  );
}

function migrateTurn(turn) {
  if (!isPlainObject(turn)) return;
  for (const field of [
    "parentExecutionId",
    "stage",
    "completionCommitId",
    "finishedAt",
    "continuedByTurnScopeId",
  ]) {
    if (!Object.hasOwn(turn, field)) turn[field] = "";
  }
  for (const field of ["failure", "finalizeIntent", "terminalStatus", "continuationSource"]) {
    if (!Object.hasOwn(turn, field)) turn[field] = null;
  }
  if (!Object.hasOwn(turn, "origin")) turn.origin = {};
  if (!Object.hasOwn(turn, "summaryVersion")) turn.summaryVersion = 0;
  if (isPlainObject(turn.failure) && Object.hasOwn(turn.failure, "phase")) {
    if (turn.failure.phase !== turn.phase) throw recordMigrationError("failure_phase_conflict");
    delete turn.failure.phase;
  }
  const intent = turn.finalizeIntent;
  if (isPlainObject(intent) && Object.hasOwn(intent, "payload")) {
    if (!isPlainObject(intent.payload) || Object.keys(intent.payload).length) {
      throw recordMigrationError("unsupported_finalize_payload");
    }
    delete intent.payload;
  }
  if (isPlainObject(intent) && turn.failure?.retryable === false) {
    const errors = collectTurnRecordErrors(turn);
    if (errors.length === 1 && errors[0] === "turn_finalize_intent_state_mismatch")
      turn.finalizeIntent = null;
  }
}

export function migrateTurnLifecycleRecords(context) {
  if (context.sourceSchemaVersion < SESSION_ARTIFACT_TURN_LIFECYCLE_RECORD_SCHEMA_VERSION) {
    for (const turn of Object.values(context.lifecycle.turns)) migrateTurn(turn);
    const active = context.lifecycle.turns[context.lifecycle.activeTurnScopeId];
    if (active && isSettledTurn(active)) context.lifecycle.activeTurnScopeId = "";
    context.changed = true;
    context.migrations.push("turn-lifecycle-record-v21");
  }
  try {
    assertTurnLifecycleRecordIntegrity(context.lifecycle);
  } catch (error) {
    if (error.code !== "TURN_LIFECYCLE_RECORD_INVALID") throw error;
    throw recordMigrationError(error.protocolErrors.join(","), error);
  }
}
