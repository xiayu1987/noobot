/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject, text as clean } from "@noobot/shared/value";
import { isSettledTurn } from "../lifecycle/turn-state.js";
import {
  normalizeCommandReceipt,
  validateCommandReceiptResult,
} from "../command/command-receipt.js";
import { validateTurnCommitMetadata } from "./turn-commit-metadata.js";
import { validateCanonicalAssistantPresentation } from "../turn-presentation.js";
import { isSessionCaller } from "@noobot/shared/session-caller";

export function createEmptyTurnLifecycle() {
  return { activeTurnScopeId: "", sequence: 0, turns: {}, replacedTurns: {}, commandReceipts: [] };
}

function isTurnLifecycleShape(lifecycle) {
  return (
    isPlainObject(lifecycle) &&
    isPlainObject(lifecycle.turns) &&
    isPlainObject(lifecycle.replacedTurns) &&
    Array.isArray(lifecycle.commandReceipts)
  );
}

export function validateSessionAggregateShape(session) {
  if (!isPlainObject(session)) return ["invalid_session"];
  const errors = [];
  if (!isSessionCaller(session.caller)) errors.push("invalid_caller");
  if (!Array.isArray(session.messages)) errors.push("invalid_messages");
  if (!Array.isArray(session.dialogOrder)) errors.push("invalid_dialog_order");
  if (!Array.isArray(session.turnTimings)) errors.push("invalid_turn_timings");
  if (!isTurnLifecycleShape(session.turnLifecycle)) errors.push("invalid_turn_lifecycle");
  return errors;
}

function invalidSessionAggregate(errors) {
  const error = new TypeError(`invalid session aggregate: ${errors.join(",")}`);
  error.code = "SESSION_PROTOCOL_INVALID";
  error.protocolErrors = errors;
  return error;
}

export function assertSessionAggregateShape(session) {
  const errors = validateSessionAggregateShape(session);
  if (errors.length) throw invalidSessionAggregate(errors);
  return session;
}

export function validateSessionAggregateInvariants(session) {
  const shapeErrors = validateSessionAggregateShape(session);
  if (shapeErrors.length) {
    return Object.freeze({ valid: false, errors: Object.freeze(shapeErrors) });
  }
  const errors = [];
  const { messages, turnLifecycle: lifecycle } = session;
  const messageUids = new Set();
  const canonicalAssistantTurns = new Set();
  for (const message of messages) {
    const messageUid = clean(message?.messageUid);
    if (!messageUid) errors.push("missing_message_uid");
    else if (messageUids.has(messageUid)) errors.push("duplicate_message_uid");
    messageUids.add(messageUid);
    if (message?.turnCommit && !validateTurnCommitMetadata(message.turnCommit).valid) {
      errors.push("invalid_turn_commit_metadata");
    }
    const presentation = validateCanonicalAssistantPresentation(message);
    errors.push(...presentation.errors);
    const presentationTurnScopeId = presentation.identity?.turnScopeId || "";
    if (presentationTurnScopeId && canonicalAssistantTurns.has(presentationTurnScopeId)) {
      errors.push("duplicate_canonical_assistant_presentation");
    }
    if (presentationTurnScopeId) canonicalAssistantTurns.add(presentationTurnScopeId);
  }
  const activeTurnScopeId = clean(lifecycle.activeTurnScopeId);
  if (
    activeTurnScopeId &&
    (!lifecycle.turns[activeTurnScopeId] || isSettledTurn(lifecycle.turns[activeTurnScopeId]))
  ) {
    errors.push("invalid_active_turn");
  }
  const replaced = new Set(Object.keys(lifecycle.replacedTurns));
  if (Object.keys(lifecycle.turns).some((turnScopeId) => replaced.has(turnScopeId)))
    errors.push("replaced_turn_materialized");
  const commandIds = new Set();
  for (const receipt of lifecycle.commandReceipts) {
    const normalized = normalizeCommandReceipt(receipt);
    if (
      !normalized ||
      Object.hasOwn(receipt, "eventType") ||
      !validateCommandReceiptResult(clean(receipt?.type), receipt?.result).valid
    ) {
      errors.push("invalid_command_receipt");
      continue;
    }
    if (commandIds.has(normalized.commandId)) errors.push("duplicate_command_receipt");
    commandIds.add(normalized.commandId);
  }
  if (Object.hasOwn(session, "turnStatuses")) errors.push("duplicate_terminal_fact");
  if (Object.hasOwn(session, "mutationReceipts")) errors.push("duplicate_command_receipts");
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function assertSessionAggregateInvariants(session) {
  const result = validateSessionAggregateInvariants(session);
  if (!result.valid) throw invalidSessionAggregate([...result.errors]);
  return session;
}
