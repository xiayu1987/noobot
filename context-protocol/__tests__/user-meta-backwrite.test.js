/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createUserMetaBackwrite,
  deriveUserMetaBackwriteId,
  normalizeUserMetaBackwrites,
} from "../src/policy/user-meta-backwrite.js";

test("user_meta backwrite identity is one-to-one per attachment", () => {
  assert.equal(
    deriveUserMetaBackwriteId("m1::user_meta", "attachment:v1:s1/user/a1"),
    "m1::user_meta::backwrite::attachment:v1:s1/user/a1",
  );
  const record = createUserMetaBackwrite({
    userMetaMessageUid: "m1::user_meta",
    attachmentRef: "attachment:v1:s1/user/a1",
    result: { sourceAttachmentRef: "attachment:v1:s1/user/a1", name: "a1" },
  });
  assert.equal(record.status, "pending");
  assert.deepEqual(normalizeUserMetaBackwrites([record]), [record]);
});

test("user_meta backwrite rejects duplicate attachment relations", () => {
  const record = {
    userMetaMessageUid: "m1::user_meta",
    attachmentRef: "attachment:v1:s1/user/a1",
    result: { sourceAttachmentRef: "attachment:v1:s1/user/a1" },
  };
  assert.throws(
    () => normalizeUserMetaBackwrites([record, record]),
    /duplicate user_meta backwrite/,
  );
});
