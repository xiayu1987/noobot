/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentTransfer,
  directTransfer,
  validateTransferEnvelope,
  createTransferIdentity,
} from "../src/index.mjs";
import { decideTransfer } from "../src/policy.mjs";

const identity = createTransferIdentity({
  sessionId: "s1",
  turnScopeId: "t1",
  runId: "r1",
  producer: { type: "tool", id: "call1" },
});

test("creates strict direct V2 envelope", () => {
  const envelope = directTransfer({
    transferId: "tr1",
    messageId: "m1",
    identity,
    direction: "output",
    intent: {
      source: "tool",
      reason: "result",
      scenario: "tool",
      strategy: "tool_output",
    },
    content: "ok",
  });
  assert.equal(envelope.version, 2);
  assert.equal(validateTransferEnvelope(envelope).ok, true);
});

test("creates attachment envelope from canonical identity and rejects paths", () => {
  const envelope = attachmentTransfer({
    transferId: "tr2",
    messageId: "m2",
    identity,
    direction: "output",
    intent: {
      source: "tool",
      reason: "result",
      scenario: "tool",
      strategy: "tool_output",
    },
    attachments: [
      {
        identity: {
          attachmentId: "a1",
          sessionId: "s1",
          attachmentSource: "model",
        },
        name: "result.txt",
      },
    ],
  });
  assert.equal(envelope.payload.mode, "attachment");
  assert.throws(() =>
    attachmentTransfer({
      transferId: "tr3",
      messageId: "m3",
      identity,
      direction: "output",
      intent: {},
      attachments: [
        {
          identity: {
            attachmentId: "a1",
            sessionId: "s1",
            attachmentSource: "model",
          },
          name: "result.txt",
          path: "/tmp/x",
        },
      ],
    }),
  );
});

test("decides attachment without fallback when content exceeds limit", () => {
  assert.equal(
    decideTransfer({
      content: "12345",
      policy: { maxDirectChars: 4 },
      capabilities: { attachmentPersistence: true },
    }).mode,
    "attachment",
  );
  assert.throws(() =>
    decideTransfer({
      content: "12345",
      policy: { maxDirectChars: 4 },
      capabilities: { attachmentPersistence: false },
    }),
  );
});
