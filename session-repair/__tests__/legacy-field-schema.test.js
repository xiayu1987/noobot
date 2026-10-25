/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION,
  SESSION_ARTIFACT_LEGACY_MESSAGE_ID_SCHEMA_VERSION,
} from "@noobot/session-protocol";
import { migrateSessionDocument } from "../src/index.js";
import { releasedSession } from "./helpers/released-session.js";

const FIELD_SCHEMA_MISMATCH = { code: "SESSION_ARTIFACT_FIELD_SCHEMA_MISMATCH" };

function userMessage(fields = {}) {
  return {
    messageUid: "user-1",
    role: "user",
    content: "hello",
    sessionId: "session-1",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    ts: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

function sessionDocument(schemaVersion, fields = {}, messageFields = {}) {
  return releasedSession({
    schemaVersion,
    sessionId: "session-1",
    aggregateVersion: 1,
    messages: [userMessage(messageFields)],
    ...fields,
  });
}

test("schema 5 migrates legacy message fields", () => {
  const result = migrateSessionDocument(
    sessionDocument(
      SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION,
      {},
      {
        injected_message_type: "summary",
        turnCommit: { action: "send", idempotencyKey: "send-1" },
      },
    ),
  );
  const [message] = result.document.messages;
  assert.equal(message.injectedMessageType, "summary");
  assert.equal(Object.hasOwn(message, "injected_message_type"), false);
  assert.equal(message.turnCommit.commandId, "send-1");
  assert.equal(Object.hasOwn(message.turnCommit, "idempotencyKey"), false);
});

test("legacy message fields beyond schema 5 are rejected", () => {
  const schemaVersion = SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION + 1;
  for (const messageFields of [
    { injected_message_type: "summary" },
    { turnCommit: { action: "send", idempotencyKey: "send-1" } },
  ]) {
    assert.throws(
      () => migrateSessionDocument(sessionDocument(schemaVersion, {}, messageFields)),
      FIELD_SCHEMA_MISMATCH,
    );
  }
});

test("legacy aggregate fields beyond schema 6 are rejected", () => {
  const schemaVersion = SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION + 1;
  for (const fields of [
    { turnStatuses: [] },
    { mutationReceipts: [] },
    { authorityEventOutbox: [] },
    {
      turnLifecycle: {
        commandReceipts: [{ commandId: "send-1", eventType: "turn.completed" }],
      },
    },
  ]) {
    assert.throws(
      () => migrateSessionDocument(sessionDocument(schemaVersion, fields)),
      FIELD_SCHEMA_MISMATCH,
    );
  }
});

test("legacy aggregate fields must be arrays within their schema", () => {
  for (const field of ["turnStatuses", "mutationReceipts", "authorityEventOutbox"]) {
    assert.throws(
      () =>
        migrateSessionDocument(
          sessionDocument(SESSION_ARTIFACT_LEGACY_AGGREGATE_FIELDS_SCHEMA_VERSION, {
            [field]: {},
          }),
        ),
      FIELD_SCHEMA_MISMATCH,
    );
  }
});

test("message id beyond schema 12 is rejected", () => {
  assert.throws(
    () =>
      migrateSessionDocument(
        sessionDocument(SESSION_ARTIFACT_LEGACY_MESSAGE_ID_SCHEMA_VERSION + 1, {}, { id: "m1" }),
      ),
    FIELD_SCHEMA_MISMATCH,
  );
});

test("released schemas reject missing aggregate fields", () => {
  for (const field of ["turnTimings", "turnLifecycle"]) {
    const document = sessionDocument(SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION);
    delete document[field];
    assert.throws(() => migrateSessionDocument(document), FIELD_SCHEMA_MISMATCH);
  }
  const document = sessionDocument(SESSION_ARTIFACT_LEGACY_MESSAGE_FIELDS_SCHEMA_VERSION);
  delete document.turnLifecycle.commandReceipts;
  assert.throws(() => migrateSessionDocument(document), FIELD_SCHEMA_MISMATCH);
});

test("unversioned sessions materialize only the aggregate fields their releases omitted", () => {
  const result = migrateSessionDocument({
    sessionId: "session-1",
    aggregateVersion: 1,
    messages: [userMessage()],
  });
  assert.deepEqual(result.document.turnTimings, []);
  assert.deepEqual(result.document.turnLifecycle.turns, {});
  assert.deepEqual(result.document.turnLifecycle.commandReceipts, []);
  assert.throws(
    () => migrateSessionDocument({ sessionId: "session-1", aggregateVersion: 1, turnTimings: [] }),
    FIELD_SCHEMA_MISMATCH,
  );
  assert.throws(
    () =>
      migrateSessionDocument({
        sessionId: "session-1",
        aggregateVersion: 1,
        messages: [],
        turnLifecycle: "invalid",
      }),
    FIELD_SCHEMA_MISMATCH,
  );
});

test("schemas 2 and 4 materialize only replacedTurns their releases omitted", () => {
  for (const schemaVersion of [2, 4]) {
    const result = migrateSessionDocument({
      schemaVersion,
      sessionId: "session-1",
      aggregateVersion: 1,
      messages: [userMessage()],
      turnTimings: [],
      turnLifecycle: { activeTurnScopeId: "", sequence: 0, turns: {}, commandReceipts: [] },
    });
    assert.deepEqual(result.document.turnLifecycle.replacedTurns, {});
    assert.throws(
      () =>
        migrateSessionDocument({
          schemaVersion,
          sessionId: "session-1",
          aggregateVersion: 1,
          messages: [userMessage()],
          turnLifecycle: { turns: {}, commandReceipts: [] },
        }),
      FIELD_SCHEMA_MISMATCH,
    );
  }
});
