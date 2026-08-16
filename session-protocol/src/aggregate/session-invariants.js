/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isSettledTurn } from "../lifecycle/turn-state.mjs";
import { normalizeCommandReceipt } from "../command/command-receipt.mjs";

const clean = (value) => String(value || "").trim();

export function validateSessionAggregateInvariants(session = {}) {
  const errors = [];
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const messageUids = new Set();
  for (const message of messages) {
    const messageUid = clean(message?.messageUid);
    if (!messageUid) errors.push("missing_message_uid");
    else if (messageUids.has(messageUid)) errors.push("duplicate_message_uid");
    messageUids.add(messageUid);
  }
  const lifecycle = session.turnLifecycle || {};
  const activeTurnScopeId = clean(lifecycle.activeTurnScopeId);
  if (
    activeTurnScopeId &&
    (!lifecycle.turns?.[activeTurnScopeId] || isSettledTurn(lifecycle.turns[activeTurnScopeId]))
  ) {
    errors.push("invalid_active_turn");
  }
  const replaced = new Set(Object.keys(lifecycle.replacedTurns || {}));
  if (Object.keys(lifecycle.turns || {}).some((turnScopeId) => replaced.has(turnScopeId)))
    errors.push("replaced_turn_materialized");
  const commandReceipts = Array.isArray(lifecycle.commandReceipts) ? lifecycle.commandReceipts : [];
  const commandIds = new Set();
  for (const receipt of commandReceipts) {
    const normalized = normalizeCommandReceipt(receipt);
    if (!normalized || Object.hasOwn(receipt || {}, "eventType")) {
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

export function assertSessionAggregateInvariants(session = {}) {
  const result = validateSessionAggregateInvariants(session);
  if (!result.valid) throw new TypeError(`invalid session aggregate: ${result.errors.join(",")}`);
  return session;
}
