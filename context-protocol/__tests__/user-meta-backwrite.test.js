/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createUserMetaBackwrite,
  isSameUserMetaBackwrite,
  mergeUserMetaParsedResults,
  normalizeUserMetaBackwrites,
} from "../src/policy/user-meta-backwrite.js";

const attachmentRef = "attachment:v1:s1/user/a1";

test("user_meta backwrite targets the source user message per attachment", () => {
  const record = createUserMetaBackwrite({
    userMetaSourceMessageUid: "sm_user",
    attachmentRef,
    result: { sourceAttachmentRef: attachmentRef, name: "a1" },
  });
  assert.equal(record.userMetaSourceMessageUid, "sm_user");
  assert.equal(record.status, "pending");
  assert.equal("backwriteId" in record, false);
  assert.deepEqual(normalizeUserMetaBackwrites([record]), [record]);
  assert.equal(isSameUserMetaBackwrite(record, { ...record, result: {} }), true);
  assert.equal(isSameUserMetaBackwrite(record, { ...record, attachmentRef: "other" }), false);
});

test("user_meta backwrite requires a source message and attachment", () => {
  assert.throws(
    () => createUserMetaBackwrite({ attachmentRef, result: {} }),
    /requires userMetaSourceMessageUid and attachmentRef/,
  );
  assert.throws(
    () =>
      createUserMetaBackwrite({ userMetaSourceMessageUid: "sm_user", attachmentRef, result: [] }),
    /result must be an object/,
  );
});

test("user_meta backwrite rejects duplicate attachment relations", () => {
  const record = {
    userMetaSourceMessageUid: "sm_user",
    attachmentRef,
    result: { sourceAttachmentRef: attachmentRef },
    createdAt: "2026-10-21T00:00:00.000Z",
    status: "pending",
  };
  assert.throws(
    () => normalizeUserMetaBackwrites([record, record]),
    /duplicate user_meta backwrite/,
  );
});

test("parsed results replace the entry for the same attachment", () => {
  const first = mergeUserMetaParsedResults([], { sourceAttachmentRef: attachmentRef, v: 1 });
  const other = mergeUserMetaParsedResults(first, { sourceAttachmentRef: "attachment:b", v: 1 });
  const replaced = mergeUserMetaParsedResults(other, { sourceAttachmentRef: attachmentRef, v: 2 });
  assert.deepEqual(replaced, [
    { sourceAttachmentRef: "attachment:b", v: 1 },
    { sourceAttachmentRef: attachmentRef, v: 2 },
  ]);
  assert.throws(() => mergeUserMetaParsedResults([], { v: 1 }), /requires sourceAttachmentRef/);
});

test("stored backwrites reject missing timestamps and invalid pending state", () => {
  const record = createUserMetaBackwrite({
    userMetaSourceMessageUid: "sm_user",
    attachmentRef,
    result: {},
  });
  for (const createdAt of [undefined, null, "", "2026-01-01", 1]) {
    assert.throws(
      () => normalizeUserMetaBackwrites([{ ...record, createdAt }]),
      /canonical createdAt/,
    );
  }
  for (const status of [undefined, "", "completed"]) {
    assert.throws(
      () => normalizeUserMetaBackwrites([{ ...record, status }]),
      /status must be pending/,
    );
  }
  assert.throws(() => normalizeUserMetaBackwrites(null), /must be an array/);
});
