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
  assert.equal(
    isSameUserMetaBackwrite(record, { ...record, result: { ...record.result, v: 2 } }),
    true,
  );
  const other = createUserMetaBackwrite({
    userMetaSourceMessageUid: record.userMetaSourceMessageUid,
    attachmentRef: "other",
    result: { sourceAttachmentRef: "other" },
  });
  assert.equal(isSameUserMetaBackwrite(record, other), false);
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

test("queued and restored backwrites reject missing or conflicting result attachment identity", () => {
  const record = {
    userMetaSourceMessageUid: "sm_user",
    attachmentRef,
    status: "pending",
    createdAt: "2026-10-21T00:00:00.000Z",
  };
  for (const [result, error] of [
    [{}, /requires sourceAttachmentRef/],
    [{ sourceAttachmentRef: ` ${attachmentRef}` }, /requires sourceAttachmentRef/],
    [{ sourceAttachmentRef: "other" }, /must match result.sourceAttachmentRef/],
  ]) {
    assert.throws(() => createUserMetaBackwrite({ ...record, result }), error);
    assert.throws(() => normalizeUserMetaBackwrites([{ ...record, result }]), error);
  }
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

test("stored backwrites reject missing timestamps and invalid pending state", () => {
  const record = createUserMetaBackwrite({
    userMetaSourceMessageUid: "sm_user",
    attachmentRef,
    result: { sourceAttachmentRef: attachmentRef },
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
