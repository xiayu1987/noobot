/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_MESSAGE_RECORD_MIGRATION_INVALID,
  migrateSessionDocumentIdentity,
} from "../src/index.js";
import {
  MESSAGE_FIELD_SCHEMA,
  MESSAGE_IDENTITY_STORE,
  MESSAGE_REMOVED_FIELD_NAME,
} from "../src/identity/message-identity-schema.js";

const STORE = MESSAGE_IDENTITY_STORE;
const LEGACY_MESSAGE_ID = MESSAGE_REMOVED_FIELD_NAME.MESSAGE_ID;

function rejects(document, store, reason) {
  assert.throws(
    () => migrateSessionDocumentIdentity(document, store),
    (error) =>
      error.code === SESSION_MESSAGE_RECORD_MIGRATION_INVALID && error.details.reason === reason,
  );
}

function outboxRecord(payload, identity = {}) {
  return {
    op: "append",
    eventId: "ev_1",
    envelope: {
      identity: { eventId: "ev_1", eventType: "turn_lifecycle", ...identity },
      payload,
    },
  };
}

test("outbox presentation splits user record rename from assistant projection dedupe", () => {
  const source = outboxRecord({
    presentation: {
      userMessage: {
        role: "user",
        messageUid: "sm_u",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        [LEGACY_MESSAGE_ID]: "msg_u",
        id: "msg_u",
      },
      assistantMessage: {
        role: "assistant",
        presentationMessageId: "msg_a",
        [LEGACY_MESSAGE_ID]: "msg_a",
        id: "msg_a",
      },
    },
  });
  const { document, changed } = migrateSessionDocumentIdentity(source, STORE.OUTBOX);
  assert.equal(changed, true);
  assert.deepEqual(document.envelope.payload.presentation, {
    userMessage: {
      role: "user",
      messageUid: "sm_u",
      messageOrigin: "natural",
      userMessageId: "msg_u",
    },
    assistantMessage: { role: "assistant", presentationMessageId: "msg_a" },
  });
  assert.equal(Object.hasOwn(source.envelope.payload.presentation.userMessage, "id"), true);
});

test("legacy event message ids are removed by path including empty values", () => {
  const source = outboxRecord(
    { [LEGACY_MESSAGE_ID]: "msg_event_1", contentFact: { [LEGACY_MESSAGE_ID]: "msg_event_1" } },
    { [LEGACY_MESSAGE_ID]: "" },
  );
  source.envelope[LEGACY_MESSAGE_ID] = "msg_event_1";
  const { document } = migrateSessionDocumentIdentity(source, STORE.OUTBOX);
  assert.deepEqual(document.envelope, {
    identity: { eventId: "ev_1", eventType: "turn_lifecycle" },
    payload: { contentFact: {} },
  });
});

test("session turn lifecycle drops derived message ids under turns and receipts", () => {
  const envelope = {
    [LEGACY_MESSAGE_ID]: "msg_event_1",
    identity: { [LEGACY_MESSAGE_ID]: "msg_event_1" },
    payload: { [LEGACY_MESSAGE_ID]: "msg_event_1" },
  };
  const { document } = migrateSessionDocumentIdentity(
    {
      turnLifecycle: {
        turns: { "client-turn:a": { [LEGACY_MESSAGE_ID]: "msg_event_1", state: "done" } },
        commandReceipts: [{ envelope }],
      },
    },
    STORE.SESSION,
  );
  assert.deepEqual(document.turnLifecycle, {
    turns: { "client-turn:a": { state: "done" } },
    commandReceipts: [{ envelope: { identity: {}, payload: {} } }],
  });
});

test("journal record and nested timelines migrate in one pass", () => {
  const { document } = migrateSessionDocumentIdentity(
    {
      op: "upsert",
      message: {
        role: "tool",
        messageUid: "sm_t",
        presentationMessageId: "pm_t",
        [LEGACY_MESSAGE_ID]: "sm_t",
        activityTimeline: [{ [LEGACY_MESSAGE_ID]: "msg_event_1", kind: "tool" }],
      },
    },
    STORE.JOURNAL,
  );
  assert.deepEqual(document.message, {
    role: "tool",
    messageUid: "sm_t",
    presentationMessageId: "pm_t",
    activityTimeline: [{ kind: "tool" }],
  });
});

test("canonical documents report no change", () => {
  const source = outboxRecord({
    presentation: { assistantMessage: { presentationMessageId: "pm" } },
  });
  const { document, changed } = migrateSessionDocumentIdentity(source, STORE.OUTBOX);
  assert.equal(changed, false);
  assert.deepEqual(document, source);
});

test("projection id that is not a duplicate is rejected", () => {
  rejects(
    outboxRecord({
      presentation: {
        assistantMessage: { presentationMessageId: "pm_a", [LEGACY_MESSAGE_ID]: "msg_other" },
      },
    }),
    STORE.OUTBOX,
    "projection_not_duplicate",
  );
});

test("non-object targets and non-array collections are rejected", () => {
  rejects(outboxRecord("not-an-object"), STORE.OUTBOX, "target_not_object");
  rejects({ turnLifecycle: { turns: "not-an-object" } }, STORE.SESSION, "path_not_object");
  rejects({ records: {} }, STORE.CHECKPOINT, "path_not_array");
  rejects({ op: "upsert", message: [] }, STORE.JOURNAL, "target_not_object");
  rejects([], STORE.JOURNAL, "document_not_object");
});

const LEGACY_REPLACEMENT_FIELD =
  MESSAGE_FIELD_SCHEMA.replacementUserMessageUid.renamedFrom[0].field;

test("session replacement references rename to replacementUserMessageUid", () => {
  const source = {
    turnLifecycle: {
      replacedTurns: { t1: { replacedByTurnScopeId: "t2", [LEGACY_REPLACEMENT_FIELD]: "sm_u" } },
      commandReceipts: [
        { result: { turnReplacement: { [LEGACY_REPLACEMENT_FIELD]: "sm_u" } } },
        { result: { deletedCount: 0 } },
      ],
    },
  };
  const { document, changed } = migrateSessionDocumentIdentity(source, STORE.SESSION);
  assert.equal(changed, true);
  assert.deepEqual(document.turnLifecycle.replacedTurns.t1, {
    replacedByTurnScopeId: "t2",
    replacementUserMessageUid: "sm_u",
  });
  assert.deepEqual(document.turnLifecycle.commandReceipts[0].result.turnReplacement, {
    replacementUserMessageUid: "sm_u",
  });
  assert.equal(
    Object.hasOwn(source.turnLifecycle.replacedTurns.t1, "replacementUserMessageUid"),
    false,
  );
});

test("session replacement rename rejects conflicting canonical values", () => {
  rejects(
    {
      turnLifecycle: {
        replacedTurns: {
          t1: { [LEGACY_REPLACEMENT_FIELD]: "sm_old", replacementUserMessageUid: "sm_new" },
        },
      },
    },
    STORE.SESSION,
    "rename_conflict",
  );
});
