/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  SESSION_ARTIFACT_CANONICAL_COMMAND_RECEIPT_SCHEMA_VERSION,
  SESSION_COMMAND,
  TURN_EVENT_VALUES,
} from "@noobot/session-protocol";
import { isLegacyEventEnvelope, validateEventEnvelope } from "@noobot/event-protocol/envelope";
import { isPlainObject, text } from "@noobot/shared/value";
import { SESSION_REPAIR_ERROR_CODE } from "./errors.js";

export const CANONICAL_COMMAND_RECEIPT_MIGRATION = "session-command-receipt-two-shapes-v1";

const SESSION_COMMAND_TYPES = new Set(Object.values(SESSION_COMMAND));
const TURN_EVENT_TYPES = new Set(TURN_EVENT_VALUES);
const SESSION_RECEIPT_PLACEHOLDERS = Object.freeze({
  eventId: "",
  envelope: null,
  revision: 0,
  sequence: 0,
});

function receiptMigrationError(reason, commandId) {
  const error = new TypeError(`Session command receipt cannot be migrated: ${reason}`);
  error.code = SESSION_REPAIR_ERROR_CODE.COMMAND_RECEIPT_UNMIGRATABLE;
  error.details = { reason, commandId };
  return error;
}

function dropPlaceholder(receipt, field, placeholder) {
  if (!Object.hasOwn(receipt, field)) return false;
  if (receipt[field] !== placeholder) {
    throw receiptMigrationError(`${field}_not_placeholder`, receipt.commandId);
  }
  delete receipt[field];
  return true;
}

function isEmptyResult(value) {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function migrateSessionReceipt(receipt) {
  let changed = false;
  for (const [field, placeholder] of Object.entries(SESSION_RECEIPT_PLACEHOLDERS)) {
    changed = dropPlaceholder(receipt, field, placeholder) || changed;
  }
  if (!Object.hasOwn(receipt, "turnScopeId")) return changed;
  if (receipt.turnScopeId === "") {
    delete receipt.turnScopeId;
    return true;
  }
  if (receipt.turnScopeId !== text(receipt.turnScopeId)) {
    throw receiptMigrationError("turnScopeId_not_canonical", receipt.commandId);
  }
  return changed;
}

function migrateTurnReceipt(receipt) {
  const validation = validateEventEnvelope(receipt.envelope);
  if (!validation.valid) {
    throw receiptMigrationError(
      `envelope_invalid:${validation.errors.join(",")}`,
      receipt.commandId,
    );
  }
  if (!Object.hasOwn(receipt, "result")) return false;
  if (!isEmptyResult(receipt.result)) {
    throw receiptMigrationError("turn_result_not_empty", receipt.commandId);
  }
  delete receipt.result;
  return true;
}

function isLostTurnEnvelope(envelope) {
  return envelope === null || isLegacyEventEnvelope(envelope);
}

export function migrateCanonicalCommandReceipts(context) {
  if (context.sourceSchemaVersion >= SESSION_ARTIFACT_CANONICAL_COMMAND_RECEIPT_SCHEMA_VERSION) {
    return;
  }
  const { lifecycle } = context;
  const droppedCommandIds = [];
  let changed = false;
  lifecycle.commandReceipts = lifecycle.commandReceipts.flatMap((source) => {
    const receipt = { ...source };
    if (SESSION_COMMAND_TYPES.has(receipt.type)) {
      changed = migrateSessionReceipt(receipt) || changed;
      return [receipt];
    }
    if (!TURN_EVENT_TYPES.has(receipt.type)) {
      throw receiptMigrationError("unknown_receipt_type", receipt.commandId);
    }
    if (isLostTurnEnvelope(receipt.envelope)) {
      droppedCommandIds.push(receipt.commandId);
      changed = true;
      return [];
    }
    changed = migrateTurnReceipt(receipt) || changed;
    return [receipt];
  });
  context.droppedCommandReceiptIds = droppedCommandIds;
  if (changed) {
    context.changed = true;
    context.migrations.push(CANONICAL_COMMAND_RECEIPT_MIGRATION);
  }
}
