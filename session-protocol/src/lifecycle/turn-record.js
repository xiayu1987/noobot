/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject, stableValue } from "@noobot/shared/value";
import { isCanonicalTurnScopeId } from "../identity/turn-scope-identity.js";
import { TURN_STATE, TURN_PHASE, isFailedTurnState, isTerminalTurnState } from "./turn-state.js";
import { TURN_EXECUTION_STATE_VALUES } from "./turn-execution-state.js";
import { TURN_ACTION } from "./turn-action.js";
import { deriveTurnEventType, deriveTurnState } from "./turn-transition-policy.js";
import { normalizeTurnTerminalStatus } from "./turn-terminal.js";
import { projectWorkflowNodeOwnership, validateExecutionIdentity } from "../execution-lifecycle.js";

const REQUIRED_TEXT = [
  "presentationMessageId",
  "executionId",
  "rootExecutionId",
  "dialogProcessId",
  "commandId",
  "startedAt",
  "createdAt",
  "updatedAt",
];
const OPTIONAL_TEXT = [
  "parentExecutionId",
  "stage",
  "action",
  "completionCommitId",
  "finishedAt",
  "continuedByTurnScopeId",
];
const INTENT_FIELDS = ["type", "commandId", "retryable", "createdAt", "updatedAt"];

export function collectFinalizeIntentErrors(intent) {
  if (intent === null) return [];
  if (!isPlainObject(intent)) return ["invalid_finalize_intent"];
  const errors = [];
  if (Object.keys(intent).some((key) => !INTENT_FIELDS.includes(key)))
    errors.push("unknown_finalize_intent_field");
  if (!["completion", "stop"].includes(intent.type)) errors.push("invalid_finalize_intent_type");
  for (const field of ["commandId", "createdAt", "updatedAt"]) {
    if (!isCanonicalText(intent[field])) errors.push(`invalid_finalize_intent_${field}`);
  }
  if (typeof intent.retryable !== "boolean") errors.push("invalid_finalize_intent_retryable");
  else if (!intent.retryable) errors.push("inactive_finalize_intent");
  return errors;
}

export function collectTurnFailureErrors(failure) {
  if (failure === null) return [];
  if (!isPlainObject(failure)) return ["invalid_turn_failure"];
  return Object.keys(failure).some((key) => !["code", "message", "retryable"].includes(key)) ||
    !isCanonicalText(failure.code) ||
    !isCanonicalText(failure.message) ||
    typeof failure.retryable !== "boolean"
    ? ["invalid_turn_failure"]
    : [];
}

function isFinalizingTurn(turn) {
  return (
    [TURN_STATE.COMPLETION_REQUESTING, TURN_STATE.STOPPING].includes(turn.state) ||
    ([TURN_STATE.COMPLETION_FAILED, TURN_STATE.STOP_FAILED].includes(turn.state) &&
      turn.failure?.retryable === true)
  );
}

function collectTurnFieldErrors(turn) {
  const errors = [];
  if (!isCanonicalTurnScopeId(turn.turnScopeId)) errors.push("invalid_turn_scope_id");
  for (const field of REQUIRED_TEXT) {
    if (!isCanonicalText(turn[field])) errors.push(`invalid_turn_${field}`);
  }
  for (const field of OPTIONAL_TEXT) {
    if (turn[field] !== "" && !isCanonicalText(turn[field])) errors.push(`invalid_turn_${field}`);
  }
  if (turn.action !== "" && !Object.values(TURN_ACTION).includes(turn.action))
    errors.push("invalid_turn_action");
  if (!["agent", "workflow"].includes(turn.executionKind))
    errors.push("invalid_turn_execution_kind");
  if (!isPlainObject(turn.origin)) errors.push("invalid_turn_origin");
  else {
    try {
      projectWorkflowNodeOwnership(turn.origin);
    } catch {
      errors.push("invalid_turn_origin");
    }
  }
  if (!validateExecutionIdentity(turn, { requireSession: false }).valid)
    errors.push("invalid_turn_execution_ownership");
  if (!Object.values(TURN_STATE).includes(turn.state)) errors.push("invalid_turn_state");
  if (!Object.values(TURN_PHASE).includes(turn.phase)) errors.push("invalid_turn_phase");
  if (turn.executionState !== "" && !TURN_EXECUTION_STATE_VALUES.includes(turn.executionState))
    errors.push("invalid_turn_execution_state");
  for (const field of ["revision", "sequence", "summaryVersion"]) {
    if (!Number.isSafeInteger(turn[field]) || turn[field] < (field === "summaryVersion" ? 0 : 1))
      errors.push(`invalid_turn_${field}`);
  }
  errors.push(
    ...collectFinalizeIntentErrors(turn.finalizeIntent),
    ...collectTurnFailureErrors(turn.failure),
  );
  return errors;
}

function collectTurnStateErrors(turn) {
  const errors = [];
  if (
    Object.values(TURN_STATE).includes(turn.state) &&
    deriveTurnState(deriveTurnEventType(turn.state, turn), turn.phase) !== turn.state
  )
    errors.push("turn_state_phase_mismatch");
  if (isFailedTurnState(turn.state) !== (turn.failure !== null))
    errors.push("turn_state_failure_mismatch");
  if (isTerminalTurnState(turn.state) && !isCanonicalText(turn.finishedAt))
    errors.push("missing_turn_finished_at");
  const finalizing = isFinalizingTurn(turn);
  if (finalizing !== (turn.finalizeIntent !== null))
    errors.push("turn_finalize_intent_state_mismatch");
  if (
    isPlainObject(turn.finalizeIntent) &&
    turn.finalizeIntent.type !== (turn.phase === TURN_PHASE.STOP ? "stop" : "completion")
  )
    errors.push("turn_finalize_intent_phase_mismatch");
  return errors;
}

function collectTurnTerminalErrors(turn) {
  const errors = [];
  const finalizing = isFinalizingTurn(turn);
  if (turn.terminalStatus !== null) {
    try {
      const status = normalizeTurnTerminalStatus(turn.terminalStatus);
      if (
        !status ||
        status.turnScopeId !== turn.turnScopeId ||
        status.dialogProcessId !== turn.dialogProcessId ||
        JSON.stringify(stableValue(status)) !== JSON.stringify(stableValue(turn.terminalStatus))
      )
        errors.push("invalid_turn_terminal_status");
      if (
        status &&
        (!isTerminalTurnState(turn.state) ||
          finalizing ||
          (turn.state === TURN_STATE.COMPLETED && status.status !== "completed") ||
          (turn.state === TURN_STATE.STOP_COMPLETED && status.status !== "user_stopped") ||
          (isFailedTurnState(turn.state) && !["error", "timeout"].includes(status.status)))
      )
        errors.push("turn_terminal_state_mismatch");
    } catch {
      errors.push("invalid_turn_terminal_status");
    }
  }
  return errors;
}

export function collectTurnContinuationErrors(turn) {
  const errors = [];
  if (
    turn.continuationSource !== null &&
    (!isPlainObject(turn.continuationSource) ||
      !isCanonicalTurnScopeId(turn.continuationSource.turnScopeId) ||
      !isCanonicalText(turn.continuationSource.dialogProcessId) ||
      turn.continuationSource.turnScopeId === turn.turnScopeId ||
      Object.keys(turn.continuationSource).some(
        (key) => !["turnScopeId", "dialogProcessId"].includes(key),
      ))
  )
    errors.push("invalid_turn_continuation_source");
  return errors;
}

export function collectTurnRecordErrors(turn) {
  if (!isPlainObject(turn)) return ["invalid_turn_record"];
  return [
    ...collectTurnFieldErrors(turn),
    ...collectTurnStateErrors(turn),
    ...collectTurnTerminalErrors(turn),
    ...collectTurnContinuationErrors(turn),
  ];
}

export function assertTurnRecord(turn) {
  const errors = collectTurnRecordErrors(turn);
  if (errors.length)
    throw Object.assign(new TypeError(`invalid turn record: ${errors.join(",")}`), {
      code: "TURN_LIFECYCLE_RECORD_INVALID",
      protocolErrors: errors,
    });
  return turn;
}

export function requireAcceptedTurnRecord(lifecycle, { turnScopeId, dialogProcessId }) {
  const turn = isPlainObject(lifecycle?.turns) ? lifecycle.turns[turnScopeId] : undefined;
  if (!turn) {
    throw Object.assign(new TypeError(`accepted Turn not found: ${turnScopeId}`), {
      code: "TURN_LIFECYCLE_TURN_NOT_FOUND",
    });
  }
  assertTurnRecord(turn);
  if (turn.dialogProcessId !== dialogProcessId) {
    throw Object.assign(new TypeError(`accepted Turn dialogProcessId mismatch: ${turnScopeId}`), {
      code: "TURN_LIFECYCLE_IDENTITY_MISMATCH",
    });
  }
  return turn;
}
