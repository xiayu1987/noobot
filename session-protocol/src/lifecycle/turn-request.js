/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isCanonicalText, isPlainObject, stableValue } from "@noobot/shared/value";
import { projectWorkflowNodeOwnership } from "../execution-lifecycle.js";
import { TURN_EVENT } from "./turn-event.js";
import { isTurnEventPhase } from "./turn-transition-policy.js";
import { TURN_ACTION } from "./turn-action.js";
import { collectTurnFailureErrors } from "./turn-record.js";
import { MESSAGE_REMOVED_FIELD_NAME } from "../identity/message-identity-schema.js";

const REQUEST_FIELDS = new Set([
  "eventType",
  "eventId",
  "userId",
  "sessionId",
  "turnScopeId",
  "commandId",
  "causationId",
  "phase",
  "action",
  "presentationMessageId",
  "dialogProcessId",
  "executionId",
  "executionKind",
  "parentExecutionId",
  "rootExecutionId",
  "origin",
  "stage",
  "continuationSource",
  "completionCommitId",
  "summaryVersion",
  "terminalStatus",
  "failure",
  "expectedRevision",
  "userMessage",
  "payload",
]);

export const TURN_REQUEST_EXECUTION_FIELDS = Object.freeze([
  "executionId",
  "executionKind",
  "parentExecutionId",
  "rootExecutionId",
  "stage",
]);

export function selectTurnRequestExecutionIdentity(source) {
  return {
    executionId: source.executionId,
    executionKind: source.executionKind,
    rootExecutionId: source.rootExecutionId,
    parentExecutionId: source.parentExecutionId === undefined ? "" : source.parentExecutionId,
    stage: source.stage === undefined ? "" : source.stage,
    origin: source.origin === undefined ? {} : source.origin,
  };
}

export function validateTurnLifecycleRequest(input) {
  if (!isPlainObject(input)) return "invalid_lifecycle_identity";
  if (Object.hasOwn(input, MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID))
    return "turn_message_id_noncanonical";
  if (Object.keys(input).some((field) => !REQUEST_FIELDS.has(field)))
    return "unknown_lifecycle_request_field";
  for (const field of ["turnScopeId", "commandId", "causationId"]) {
    if (!isCanonicalText(input[field])) return "invalid_lifecycle_identity";
  }
  if (!isTurnEventPhase(input.eventType, input.phase)) return "invalid_lifecycle_event_phase";
  if (
    Object.hasOwn(input, "summaryVersion") &&
    (!Number.isSafeInteger(input.summaryVersion) || input.summaryVersion < 0)
  )
    return "invalid_summary_version";
  for (const field of [
    "presentationMessageId",
    "dialogProcessId",
    "executionId",
    "rootExecutionId",
    "completionCommitId",
  ]) {
    if (Object.hasOwn(input, field) && input[field] !== "" && !isCanonicalText(input[field]))
      return "invalid_lifecycle_request_field";
  }
  for (const field of ["parentExecutionId", "stage"]) {
    if (Object.hasOwn(input, field) && input[field] !== "" && !isCanonicalText(input[field]))
      return "execution_identity_invalid";
  }
  if (Object.hasOwn(input, "executionKind") && !["agent", "workflow"].includes(input.executionKind))
    return "execution_identity_invalid";
  if (Object.hasOwn(input, "action") && !Object.values(TURN_ACTION).includes(input.action))
    return "invalid_turn_action";
  if (Object.hasOwn(input, "origin")) {
    try {
      projectWorkflowNodeOwnership(input.origin);
    } catch {
      return "execution_identity_invalid";
    }
  }
  if (input.eventType === TURN_EVENT.FAILED) {
    if (collectTurnFailureErrors(input.failure).length || input.failure === null)
      return "turn_failure_incomplete";
  } else if (Object.hasOwn(input, "failure") && input.failure !== null) {
    return "unexpected_turn_failure";
  }
  if (Object.hasOwn(input, "continuationSource") && input.continuationSource !== null) {
    const source = input.continuationSource;
    if (
      !isPlainObject(source) ||
      !isCanonicalText(source.turnScopeId) ||
      !isCanonicalText(source.dialogProcessId) ||
      Object.keys(source).some((field) => !["turnScopeId", "dialogProcessId"].includes(field))
    )
      return "continue_source_identity_incomplete";
  }
  return "";
}

export function findTurnExecutionIdentityConflict(input, stored) {
  if (
    TURN_REQUEST_EXECUTION_FIELDS.some(
      (field) => Object.hasOwn(input, field) && input[field] !== stored[field],
    )
  )
    return true;
  return (
    Object.hasOwn(input, "origin") &&
    JSON.stringify(stableValue(input.origin)) !== JSON.stringify(stableValue(stored.origin))
  );
}
