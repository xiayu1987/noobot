/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_IDENTITY_FIELD,
  assertMessageIdentity,
  createMessageUid,
  createModelMessageId,
  createPresentationMessageId,
  createUserMessageId,
  isMessageIdentity,
} from "../src/identity/message-identity.js";

test("each identity kind has one field name", () => {
  assert.deepEqual(MESSAGE_IDENTITY_FIELD, {
    PRESENTATION: "presentationMessageId",
    MODEL: "modelMessageId",
    SESSION: "messageUid",
    USER: "userMessageId",
  });
  assert.equal(Object.isFrozen(MESSAGE_IDENTITY_FIELD), true);
});

test("generators produce unique prefixed identities", () => {
  const cases = [
    [createMessageUid, /^sm_[0-9a-f-]{36}$/],
    [createModelMessageId, /^mm_[0-9a-f-]{36}$/],
    [createPresentationMessageId, /^pm_[0-9a-f-]{36}$/],
    [createUserMessageId, /^um_[0-9a-f-]{36}$/],
  ];
  for (const [create, pattern] of cases) {
    const first = create();
    assert.match(first, pattern);
    assert.notEqual(first, create());
    assert.equal(isMessageIdentity(first), true);
  }
});

test("assertMessageIdentity rejects unknown fields and invalid values", () => {
  assert.equal(assertMessageIdentity("presentationMessageId", "msg_1"), "msg_1");
  assert.throws(
    () => assertMessageIdentity("messageId", "msg_1"),
    /unknown message identity field/,
  );
  for (const value of ["", " msg_1", "msg_1 ", null, undefined, 1, {}]) {
    assert.throws(() => assertMessageIdentity("modelMessageId", value), /invalid modelMessageId/);
  }
});
