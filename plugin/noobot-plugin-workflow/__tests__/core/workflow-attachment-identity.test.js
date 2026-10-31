/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";
import { TRANSFER_VERSION, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";

import {
  mergeAttachments,
  resolveNodeInputAttachments,
  resolveWorkflowTransferAttachmentReferences,
} from "../../src/core/hooks/attachments.js";

const base = {
  attachmentId: "shared",
  sessionId: "session-a",
  attachmentSource: "user",
  name: "same.txt",
  mimeType: "text/plain",
};
const baseIdentity = {
  attachmentId: base.attachmentId,
  sessionId: base.sessionId,
  attachmentSource: base.attachmentSource,
};

test("workflow attachment merge isolates equal ids across session and source", () => {
  const merged = mergeAttachments(
    [base],
    [
      { ...base, sessionId: "session-b" },
      { ...base, attachmentSource: "model" },
    ],
  );
  assert.equal(merged.length, 3);
});

test("workflow node refs resolve only complete canonical attachment identities", () => {
  const attachments = [base];
  const resolved = resolveNodeInputAttachments({
    ctx: { userMessageAttachments: attachments },
    semanticNode: { attachments: [formatAttachmentIdentityRef(baseIdentity)] },
  });
  assert.deepEqual(resolved, [base]);
  assert.throws(
    () =>
      resolveNodeInputAttachments({
        ctx: { userMessageAttachments: attachments },
        semanticNode: { attachments: ["shared"] },
      }),
    /invalid_attachment_identity_ref_prefix/,
  );
  assert.throws(
    () =>
      resolveNodeInputAttachments({
        ctx: { userMessageAttachments: attachments },
        semanticNode: {
          attachments: [formatAttachmentIdentityRef({ ...baseIdentity, sessionId: "session-b" })],
        },
      }),
    /workflow_attachment_not_available/,
  );
});

test("workflow attachment operations reject incomplete identity", () => {
  assert.throws(
    () => mergeAttachments([], [{ attachmentId: "shared", sessionId: "session-a" }]),
    /invalid_attachment_source/,
  );
  assert.throws(
    () =>
      resolveNodeInputAttachments({
        ctx: { userMessageAttachments: [{ attachmentId: "shared", attachmentSource: "user" }] },
        semanticNode: { attachments: [formatAttachmentIdentityRef(baseIdentity)] },
      }),
    /invalid_attachment_session_id/,
  );
  assert.throws(
    () =>
      resolveWorkflowTransferAttachmentReferences({
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: TRANSFER_VERSION,
            transferId: "transfer-invalid",
            presentationMessageId: "presentation-invalid",
            identity: { sessionId: "session-a", producer: { type: "tool", id: "tool-1" } },
            direction: "output",
            payload: {
              mode: "attachment",
              attachments: [
                {
                  identity: { attachmentId: "shared", attachmentSource: "user" },
                  role: "primary",
                  name: "same.txt",
                  mimeType: "text/plain",
                },
              ],
            },
            intent: {
              source: "plugin",
              reason: TRANSFER_REASON.WORKFLOW_SUBAGENT,
              scenario: "workflow",
              strategy: "workflow_subagent",
            },
            meta: {},
          },
        ],
      }),
    /invalid_attachment_session_id/,
  );
});
