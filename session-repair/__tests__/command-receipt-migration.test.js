/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ARTIFACT_CANONICAL_COMMAND_RECEIPT_SCHEMA_VERSION,
  SESSION_COMMAND,
  TURN_EVENT,
  normalizeCommandReceipts,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { CANONICAL_COMMAND_RECEIPT_MIGRATION } from "../src/command-receipt-migration.js";
import { EVENT_PROTOCOL_VERSION } from "@noobot/event-protocol/envelope";
import { eventEnvelope as protocolEnvelope } from "./helpers/event-envelope.js";

const LEGACY_SCHEMA_VERSION = SESSION_ARTIFACT_CANONICAL_COMMAND_RECEIPT_SCHEMA_VERSION - 1;

const ENVELOPE_FACTS = Object.freeze({
  eventId: "ev_1",
  eventType: TURN_EVENT.ACTION_ACCEPTED,
  sessionId: "s1",
  turnScopeId: "t1",
  sequence: 1,
});

function eventEnvelope(overrides = {}) {
  return protocolEnvelope(ENVELOPE_FACTS, overrides);
}

function sessionReceipt(overrides = {}) {
  return {
    commandId: "delete:s1:t1",
    type: SESSION_COMMAND.MESSAGE_DELETE_FROM,
    requestHash: "hash-delete",
    aggregateVersion: 4,
    committedAt: "2026-10-01T00:00:00.000Z",
    result: { deletedCount: 1, anchorIndex: 0, deletedTurnScopeIds: ["t1"] },
    ...overrides,
  };
}

function turnReceipt(overrides = {}) {
  return {
    commandId: "t1:accepted",
    type: TURN_EVENT.ACTION_ACCEPTED,
    requestHash: "hash-turn",
    committedAt: "2026-10-01T00:00:00.000Z",
    turnScopeId: "t1",
    revision: 1,
    sequence: 1,
    eventId: "ev_1",
    envelope: eventEnvelope(),
    ...overrides,
  };
}

function migrate(commandReceipts, schemaVersion = LEGACY_SCHEMA_VERSION) {
  return migrateSessionDocument({
    schemaVersion,
    sessionId: "s1",
    aggregateVersion: 4,
    messages: [],
    turnLifecycle: { commandReceipts },
  });
}

function rejectionReason(commandReceipts) {
  try {
    migrate(commandReceipts);
  } catch (error) {
    assert.equal(error.code, "SESSION_COMMAND_RECEIPT_UNMIGRATABLE");
    return error.details.reason;
  }
  return "";
}

test("receipt migration drops placeholders and keeps protocol facts", () => {
  const result = migrate([
    sessionReceipt({ eventId: "", envelope: null, revision: 0, sequence: 0, turnScopeId: "" }),
    turnReceipt({ result: {} }),
  ]);
  const receipts = result.document.turnLifecycle.commandReceipts;
  assert.deepEqual(receipts, [sessionReceipt(), turnReceipt()]);
  assert.deepEqual(normalizeCommandReceipts(receipts), receipts);
  assert.ok(result.migrations.includes(CANONICAL_COMMAND_RECEIPT_MIGRATION));
  assert.deepEqual(result.droppedCommandReceiptIds, []);
});

test("receipt migration removes turn receipts whose envelope was lost and reports them", () => {
  const result = migrate([
    turnReceipt({ envelope: null, result: {} }),
    turnReceipt({ commandId: "t1:started" }),
  ]);
  assert.deepEqual(
    result.document.turnLifecycle.commandReceipts.map((receipt) => receipt.commandId),
    ["t1:started"],
  );
  assert.deepEqual(result.droppedCommandReceiptIds, ["t1:accepted"]);
});

test("receipt migration removes turn receipts whose envelope predates the v3 event protocol", () => {
  const flatEnvelope = { eventId: "ev_1", eventType: TURN_EVENT.ACTION_ACCEPTED, payload: {} };
  const olderEnvelope = eventEnvelope({
    protocol: { ...eventEnvelope().protocol, version: EVENT_PROTOCOL_VERSION - 1 },
  });
  const result = migrate([
    turnReceipt({ envelope: flatEnvelope }),
    turnReceipt({ commandId: "t1:older", envelope: olderEnvelope }),
    turnReceipt({ commandId: "t1:started" }),
  ]);
  assert.deepEqual(
    result.document.turnLifecycle.commandReceipts.map((receipt) => receipt.commandId),
    ["t1:started"],
  );
  assert.deepEqual(result.droppedCommandReceiptIds, ["t1:accepted", "t1:older"]);
});

test("receipt migration rejects v3 envelopes that fail protocol validation", () => {
  const broken = eventEnvelope({ producer: { type: "agent" } });
  assert.equal(
    rejectionReason([turnReceipt({ envelope: broken })]),
    "envelope_invalid:missing_producer_id",
  );
  const missing = turnReceipt();
  delete missing.envelope;
  assert.equal(rejectionReason([missing]), "envelope_invalid:envelope_not_object");
});

test("receipt migration rejects values that are not placeholders", () => {
  assert.equal(rejectionReason([sessionReceipt({ eventId: "ev_9" })]), "eventId_not_placeholder");
  assert.equal(rejectionReason([sessionReceipt({ revision: 3 })]), "revision_not_placeholder");
  assert.equal(
    rejectionReason([sessionReceipt({ turnScopeId: " t1" })]),
    "turnScopeId_not_canonical",
  );
  assert.equal(rejectionReason([turnReceipt({ result: { ok: true } })]), "turn_result_not_empty");
  assert.equal(rejectionReason([turnReceipt({ type: "turn.unknown" })]), "unknown_receipt_type");
});

test("receipt migration is gated by the canonical receipt schema version", () => {
  const source = [turnReceipt({ result: {} })];
  const result = migrate(source, SESSION_ARTIFACT_CANONICAL_COMMAND_RECEIPT_SCHEMA_VERSION);
  assert.deepEqual(result.document.turnLifecycle.commandReceipts, source);
  assert.equal(result.migrations.includes(CANONICAL_COMMAND_RECEIPT_MIGRATION), false);
});
