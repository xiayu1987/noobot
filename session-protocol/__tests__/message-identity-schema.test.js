/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_FIELD_KIND,
  MESSAGE_FIELD_SCHEMA,
  MESSAGE_IDENTITY_CATEGORY,
  MESSAGE_IDENTITY_STORE,
  isCategorizedMessageIdentityName,
  isRegisteredMessageIdentityField,
  messageFieldRenamesFor,
} from "../src/identity/message-identity-schema.js";

test("schema has exactly one key and every field declares a known kind and category", () => {
  const entries = Object.entries(MESSAGE_FIELD_SCHEMA);
  const keys = entries.filter(([, spec]) => spec.kind === MESSAGE_FIELD_KIND.KEY);
  assert.deepEqual(
    keys.map(([name]) => name),
    ["messageUid"],
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
  assert.deepEqual(prefixes, ["sm_", "mm_", "pm_", "um_"]);
  assert.equal(new Set(prefixes).size, prefixes.length);
});

test("references and derived fields point at the session key category", () => {
  for (const [name, spec] of Object.entries(MESSAGE_FIELD_SCHEMA)) {
    if (spec.kind === MESSAGE_FIELD_KIND.REFERENCE) {
      assert.equal(spec.category, MESSAGE_IDENTITY_CATEGORY.SESSION, name);
      assert.match(name, /MessageUids?$/);
    }
    if (spec.kind === MESSAGE_FIELD_KIND.DERIVED) {
      assert.equal(spec.derivedFrom, MESSAGE_IDENTITY_CATEGORY.SESSION, name);
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
  assert.equal(renames.find((entry) => entry.to === "userMessageId").duplicateOf, "messageUid");
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
