/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_MESSAGE_RECORD_MIGRATION_INVALID,
  assertSessionMessageRecordIdentity,
  migrateSessionMessageRecordIdentity,
} from "../src/aggregate/session-message-record.js";
import {
  MESSAGE_IDENTITY_STORE,
  MESSAGE_REMOVED_FIELD_NAME,
} from "../src/identity/message-identity-schema.js";

const JOURNAL = MESSAGE_IDENTITY_STORE.JOURNAL;
const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

function rejects(record, reason) {
  assert.throws(
    () => migrateSessionMessageRecordIdentity(record, JOURNAL),
    (error) =>
      error.code === SESSION_MESSAGE_RECORD_MIGRATION_INVALID && error.details.reason === reason,
  );
}

test("assistant messageId is renamed to modelMessageId", () => {
  const { record, changed } = migrateSessionMessageRecordIdentity(
    {
      sessionId: "s",
      role: "assistant",
      messageUid: "sm_a",
      presentationMessageId: "pm_a",
      [LEGACY_MESSAGE_ID]: "msg_1",
      modelMessageId: "msg_1",
    },
    JOURNAL,
  );
  assert.equal(changed, true);
  assert.deepEqual(record, {
    sessionId: "s",
    role: "assistant",
    messageUid: "sm_a",
    presentationMessageId: "pm_a",
    modelMessageId: "msg_1",
  });
  assertSessionMessageRecordIdentity(record);
});

test("user messageId becomes userMessageId unless it duplicates messageUid", () => {
  const client = migrateSessionMessageRecordIdentity(
    { role: "user", messageUid: "sm_u", [LEGACY_MESSAGE_ID]: "client-1", messageOrigin: "natural" },
    JOURNAL,
  ).record;
  assert.equal(client.userMessageId, "client-1");
  assert.equal(LEGACY_MESSAGE_ID in client, false);
  const duplicate = migrateSessionMessageRecordIdentity(
    { role: "user", messageUid: "sm_u", [LEGACY_MESSAGE_ID]: "sm_u" },
    JOURNAL,
  ).record;
  assert.deepEqual(duplicate, { role: "user", messageUid: "sm_u" });
});

test("tool and system messageId equal to messageUid are removed", () => {
  for (const role of ["tool", "system"]) {
    const { record } = migrateSessionMessageRecordIdentity(
      { role, messageUid: "sm_t", [LEGACY_MESSAGE_ID]: "sm_t" },
      JOURNAL,
    );
    assert.deepEqual(record, { role, messageUid: "sm_t" });
  }
});

test("userMetaMaterialized consistent with messageOrigin is removed", () => {
  const { record } = migrateSessionMessageRecordIdentity(
    { role: "user", messageUid: "sm_u", userMetaMaterialized: true, messageOrigin: "natural" },
    JOURNAL,
  );
  assert.deepEqual(record, { role: "user", messageUid: "sm_u", messageOrigin: "natural" });
});

test("duplicate legacy id is removed", () => {
  const { record } = migrateSessionMessageRecordIdentity(
    { role: "tool", messageUid: "sm_t", id: "sm_t" },
    JOURNAL,
  );
  assert.deepEqual(record, { role: "tool", messageUid: "sm_t" });
});

test("canonical records are unchanged", () => {
  const source = { role: "assistant", messageUid: "sm_a", modelMessageId: "msg_1" };
  const { record, changed } = migrateSessionMessageRecordIdentity(source, JOURNAL);
  assert.equal(changed, false);
  assert.deepEqual(record, source);
});

test("conflicting or unprovable legacy values are rejected", () => {
  rejects(
    {
      role: "assistant",
      messageUid: "sm_a",
      [LEGACY_MESSAGE_ID]: "msg_1",
      modelMessageId: "msg_2",
    },
    "rename_conflict",
  );
  rejects(
    { role: "tool", messageUid: "sm_t", [LEGACY_MESSAGE_ID]: "other" },
    "removal_not_duplicate",
  );
  rejects(
    { role: "user", messageUid: "sm_u", userMetaMaterialized: true, messageOrigin: "injected" },
    "removal_inconsistent",
  );
  rejects({ role: "tool", messageUid: "sm_t", id: "other" }, "removal_not_duplicate");
  rejects(
    { role: "assistant", messageUid: "sm_a", userMetaMaterialized: false },
    "removal_role_mismatch",
  );
  rejects({ role: "", messageUid: "sm_x", [LEGACY_MESSAGE_ID]: "sm_x" }, "removal_role_mismatch");
  rejects(null, "record_not_object");
});
