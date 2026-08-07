/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkflowTransferPayloadFromAttachments,
  mergeAttachments,
  resolveNodeInputAttachments,
  resolveWorkflowAttachmentsFromTransferPayload,
} from "../../src/core/hooks/attachments.js";

const base = {
  attachmentId: "shared",
  sessionId: "session-a",
  attachmentSource: "user",
  name: "same.txt",
  path: "/workspace/same.txt",
};

test("workflow attachment merge isolates equal ids across session and source", () => {
  const merged = mergeAttachments([base], [
    { ...base, sessionId: "session-b" },
    { ...base, attachmentSource: "model" },
  ]);
  assert.equal(merged.length, 3);
});

test("workflow node refs resolve local aliases only through canonical identity", () => {
  const attachments = [
    base,
    { ...base, sessionId: "session-b" },
    { ...base, attachmentSource: "model" },
  ];
  const resolved = resolveNodeInputAttachments({
    ctx: { attachments },
    semanticNode: { attachments: ["local-file"] },
    semantic: {
      attachmentMap: {
        "local-file": { id: "local-file", ...base },
      },
    },
  });
  assert.deepEqual(resolved, [base]);
});

test("workflow attachment operations reject incomplete identity", () => {
  assert.throws(
    () => mergeAttachments([], [{ attachmentId: "shared", sessionId: "session-a" }]),
    /invalid_attachment_source/,
  );
  assert.throws(
    () => resolveNodeInputAttachments({
      ctx: { attachments: [{ attachmentId: "shared", attachmentSource: "user" }] },
      semanticNode: { attachments: ["local-file"] },
      semantic: { attachmentMap: {} },
    }),
    /invalid_attachment_session_id/,
  );
  assert.throws(
    () => buildWorkflowTransferPayloadFromAttachments([
      { attachmentId: "shared", sessionId: "session-a", name: "same.txt" },
    ]),
    /invalid_attachment_source/,
  );
  assert.throws(
    () => resolveWorkflowAttachmentsFromTransferPayload({
      transferEnvelopes: [{
        files: [{ attachmentMeta: { attachmentId: "shared", attachmentSource: "user" } }],
      }],
    }),
    /invalid_attachment_session_id/,
  );
});

test("workflow transfer preserves canonical identity isolation without flattening metadata", () => {
  const attachments = [
    base,
    { ...base, sessionId: "session-b" },
    { ...base, attachmentSource: "model" },
  ];
  const payload = buildWorkflowTransferPayloadFromAttachments(attachments);
  assert.equal(payload.transferEnvelopes[0].files.length, 3);
  assert.equal(payload.transferEnvelopes[0].files[0].attachmentId, undefined);
  assert.deepEqual(resolveWorkflowAttachmentsFromTransferPayload(payload), attachments);
});
