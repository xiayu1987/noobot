/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { migrateSessionDocument } from "../src/index.js";

function aggregateVersionMigrationError(source) {
  try {
    migrateSessionDocument(source);
  } catch (error) {
    return error.code;
  }
  return "";
}

test("aggregate version contract writes 0 only for an uncommitted Session", () => {
  const result = migrateSessionDocument({ schemaVersion: 8, sessionId: "session-1", messages: [] });
  assert.equal(result.document.aggregateVersion, 0);
  assert.ok(result.migrations.includes("session-aggregate-version-contract-v1"));
});

test("aggregate version contract rejects a committed Session without a version", () => {
  assert.equal(
    aggregateVersionMigrationError({
      schemaVersion: 8,
      sessionId: "session-1",
      messages: [{ messageUid: "u1", messageId: "m1", role: "user" }],
    }),
    "SESSION_AGGREGATE_VERSION_UNMIGRATABLE",
  );
});

test("aggregate version contract rejects conflicting legacy version fields", () => {
  assert.equal(
    aggregateVersionMigrationError({
      schemaVersion: 8,
      sessionId: "session-1",
      aggregateVersion: 3,
      version: 2,
      messages: [],
    }),
    "SESSION_AGGREGATE_VERSION_UNMIGRATABLE",
  );
  const result = migrateSessionDocument({
    schemaVersion: 8,
    sessionId: "session-1",
    aggregateVersion: 3,
    version: 3,
    messages: [],
  });
  assert.equal(result.document.aggregateVersion, 3);
  assert.equal(Object.hasOwn(result.document, "version"), false);
});

test("aggregate version contract removes versions fabricated on lifecycle receipts", () => {
  const result = migrateSessionDocument({
    schemaVersion: 8,
    sessionId: "session-1",
    aggregateVersion: 1,
    messages: [],
    turnLifecycle: {
      turns: {},
      commandReceipts: [
        {
          commandId: "turn-1:turn.accepted",
          type: "turn.accepted",
          requestHash: "hash-1",
          aggregateVersion: 0,
          revision: 1,
          sequence: 1,
        },
      ],
    },
  });
  const [receipt] = result.document.turnLifecycle.commandReceipts;
  assert.equal(Object.hasOwn(receipt, "aggregateVersion"), false);
  assert.equal(receipt.revision, 1);
});
