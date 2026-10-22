/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_FIELD_REMOVALS,
  MESSAGE_FIELD_KIND,
  MESSAGE_FIELD_SCHEMA,
  MESSAGE_IDENTITY_CATEGORY,
  MESSAGE_IDENTITY_STORE,
  MESSAGE_PATH_RULES,
  MESSAGE_PATH_RULE_KIND,
  MESSAGE_REMOVAL_REASON,
  acceptedMessageIdentityFieldsFor,
  isCategorizedMessageIdentityName,
  isRegisteredMessageIdentityField,
  messageFieldRemovalsFor,
  messageFieldRenamesFor,
  messageRecordIdentityFieldsFor,
} from "../src/identity/message-identity-schema.js";

test("schema has one key per identity category and every field declares a known kind", () => {
  const entries = Object.entries(MESSAGE_FIELD_SCHEMA);
  const keys = entries.filter(([, spec]) => spec.kind === MESSAGE_FIELD_KIND.KEY);
  assert.deepEqual(
    keys.map(([name, spec]) => [name, spec.category]),
    [
      ["messageUid", MESSAGE_IDENTITY_CATEGORY.SESSION],
      ["contextMessageId", MESSAGE_IDENTITY_CATEGORY.CONTEXT],
    ],
  );
  for (const [name, spec] of entries) {
    assert.ok(Object.values(MESSAGE_FIELD_KIND).includes(spec.kind), name);
    assert.ok(Object.values(MESSAGE_IDENTITY_CATEGORY).includes(spec.category), name);
    assert.equal(Object.isFrozen(spec), true, name);
  }
});

test("generated identity categories use distinct prefixes", () => {
  const prefixes = Object.values(MESSAGE_FIELD_SCHEMA)
    .map((spec) => spec.prefix)
    .filter(Boolean);
  assert.deepEqual(prefixes, ["sm_", "mm_", "pm_", "um_", "cm_"]);
  assert.equal(new Set(prefixes).size, prefixes.length);
});

test("references point at the session key category", () => {
  for (const [name, spec] of Object.entries(MESSAGE_FIELD_SCHEMA)) {
    if (spec.kind === MESSAGE_FIELD_KIND.REFERENCE) {
      assert.equal(spec.category, MESSAGE_IDENTITY_CATEGORY.SESSION, name);
      assert.match(name, /MessageUids?$/);
    }
  }
});

test("registry rejects unregistered and legacy names", () => {
  assert.equal(isRegisteredMessageIdentityField("messageUid"), true);
  assert.equal(isRegisteredMessageIdentityField("replacementUserMessageUid"), true);
  for (const name of [
    "messageId",
    "noobotMessageId",
    "replacementUserMessageId",
    "summarizedMessageIds",
  ]) {
    assert.equal(isRegisteredMessageIdentityField(name), false, name);
  }
});

test("qualified names must end with a registered field", () => {
  for (const name of [
    "activePresentationMessageId",
    "matchedPresentationMessageIds",
    "summarizedMessageUids",
    "sourceMessageUid",
  ]) {
    assert.equal(isCategorizedMessageIdentityName(name), true, name);
  }
  for (const name of [
    "messageId",
    "summarizedMessageIds",
    "sourceMessageId",
    "PresentationMessageId",
  ]) {
    assert.equal(isCategorizedMessageIdentityName(name), false, name);
  }
});

test("journal renames split bare messageId by role and drop the session uid duplicate", () => {
  const renames = messageFieldRenamesFor(MESSAGE_IDENTITY_STORE.JOURNAL);
  assert.deepEqual(
    renames.map(({ from, to, roles }) => [from, to, roles]),
    [
      ["messageId", "modelMessageId", ["assistant"]],
      ["messageId", "userMessageId", ["user"]],
    ],
  );
  assert.deepEqual(renames.find((entry) => entry.to === "userMessageId").duplicateOf, [
    "messageUid",
  ]);
});

test("every legacy field maps to one target per store", () => {
  for (const store of Object.values(MESSAGE_IDENTITY_STORE)) {
    const seen = new Set();
    for (const { from, roles } of messageFieldRenamesFor(store)) {
      const key = `${from}|${(roles || ["*"]).join(",")}`;
      assert.equal(seen.has(key), false, `${store}:${key}`);
      seen.add(key);
    }
  }
});

test("record identity fields are derived per role from schema roles", () => {
  assert.deepEqual(messageRecordIdentityFieldsFor("assistant"), {
    allowed: ["modelMessageId", "presentationMessageId"],
    forbidden: ["userMessageId"],
    required: ["modelMessageId", "presentationMessageId"],
  });
  assert.deepEqual(messageRecordIdentityFieldsFor("user"), {
    allowed: ["userMessageId"],
    forbidden: ["modelMessageId", "presentationMessageId"],
    required: [],
  });
  assert.deepEqual(messageRecordIdentityFieldsFor("tool"), {
    allowed: ["presentationMessageId"],
    forbidden: ["modelMessageId", "userMessageId"],
    required: ["presentationMessageId"],
  });
});

test("only newly accepted user messages require the client identity", () => {
  assert.deepEqual(acceptedMessageIdentityFieldsFor("user"), ["userMessageId"]);
  assert.deepEqual(acceptedMessageIdentityFieldsFor("assistant"), []);
});

test("every removal is lossless by duplicate, consistency or derivation", () => {
  for (const entry of MESSAGE_FIELD_REMOVALS) {
    const proven = Boolean(entry.duplicateOf?.length) || typeof entry.consistentWith === "function";
    assert.ok(proven, entry.field);
    assert.ok(entry.stores.length > 0, entry.field);
  }
  for (const rule of MESSAGE_PATH_RULES) {
    const label = `${rule.store}:${rule.path.join(".")}`;
    if (rule.kind === MESSAGE_PATH_RULE_KIND.RECORD) {
      assert.equal(rule.fields, null, label);
      continue;
    }
    assert.ok(rule.fields.length > 0, label);
    if (rule.kind === MESSAGE_PATH_RULE_KIND.PROJECTION) {
      assert.ok(rule.duplicateOf.length > 0, label);
    } else if (rule.kind === MESSAGE_PATH_RULE_KIND.RENAME) {
      const legacy = MESSAGE_FIELD_SCHEMA[rule.target].renamedFrom
        .filter((entry) => entry.stores.includes(rule.store))
        .map((entry) => entry.field);
      assert.deepEqual(rule.fields, legacy, label);
    } else {
      assert.notEqual(rule.reason, MESSAGE_REMOVAL_REASON.DUPLICATE, label);
    }
  }
  const userMeta = messageFieldRemovalsFor(MESSAGE_IDENTITY_STORE.JOURNAL).find(
    (entry) => entry.field === "userMetaMaterialized",
  );
  assert.equal(userMeta.consistentWith(true, { messageOrigin: "natural" }), true);
  assert.equal(userMeta.consistentWith(false, { messageOrigin: "internal" }), true);
  assert.equal(userMeta.consistentWith(false, {}), true);
  assert.equal(userMeta.consistentWith(true, {}), false);
  const alias = messageFieldRemovalsFor(MESSAGE_IDENTITY_STORE.CHECKPOINT).find(
    (entry) => entry.field === "id",
  );
  assert.deepEqual(alias.duplicateOf, ["messageUid", "messageId"]);
});
