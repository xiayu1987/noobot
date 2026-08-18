/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatAttachmentIdentityRef } from "@noobot/attachment-protocol";

import {
  buildWorkflowTransferPayloadFromAttachments,
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
    ctx: { attachments },
    semanticNode: { attachments: [formatAttachmentIdentityRef(baseIdentity)] },
  });
  assert.deepEqual(resolved, [base]);
  assert.throws(
    () =>
      resolveNodeInputAttachments({
        ctx: { attachments },
        semanticNode: { attachments: ["shared"] },
      }),
    /invalid_attachment_identity_ref_prefix/,
  );
  assert.throws(
    () =>
      resolveNodeInputAttachments({
        ctx: { attachments },
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
        ctx: { attachments: [{ attachmentId: "shared", attachmentSource: "user" }] },
        semanticNode: { attachments: [formatAttachmentIdentityRef(baseIdentity)] },
      }),
    /invalid_attachment_session_id/,
  );
  assert.throws(
    () =>
      buildWorkflowTransferPayloadFromAttachments({
        attachments: [
          {
            attachmentId: "shared",
            sessionId: "session-a",
            attachmentSource: "user",
            name: "same.txt",
            mimeType: "text/plain",
          },
        ],
      }),
    /workflow transfer identity is required/,
  );
  assert.throws(
    () =>
      resolveWorkflowTransferAttachmentReferences({
        transferEnvelopes: [
          {
            protocol: "noobot.semantic-transfer",
            version: 2,
            transferId: "transfer-invalid",
            messageId: "message-invalid",
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
              reason: "workflow_task_result",
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

test("workflow transfer preserves canonical identity isolation without flattening metadata", () => {
  const attachments = [
    base,
    { ...base, sessionId: "session-b" },
    { ...base, attachmentSource: "model" },
  ];
  const payload = buildWorkflowTransferPayloadFromAttachments({
    attachments,
    transferId: "transfer-shared",
    messageId: "message-shared",
    identity: {
      sessionId: "session-a",
      turnScopeId: "turn-shared",
      runId: "run-shared",
      producer: { type: "workflow", id: "workflow-1" },
    },
    intent: {
      source: "plugin",
      reason: "test",
      scenario: "workflow",
      strategy: "workflow_subagent",
    },
  });
  assert.equal(payload.transferEnvelopes[0].payload.attachments.length, 3);
  assert.equal(payload.transferEnvelopes[0].payload.attachments[0].identity.attachmentId, "shared");
  assert.deepEqual(
    resolveWorkflowTransferAttachmentReferences(payload).map((ref) => ref.identity),
    attachments.map(({ attachmentId, sessionId, attachmentSource }) => ({
      attachmentId,
      sessionId,
      attachmentSource,
    })),
  );
});
