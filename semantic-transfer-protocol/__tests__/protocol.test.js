/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentTransfer,
  sourceReferenceTransfer,
  directTransfer,
  validateTransferEnvelope,
  createTransferIdentity,
  assertSemanticTransferRegistration,
  getToolInputPolicy,
  getToolOutputPolicy,
  hasToolInputPolicy,
  assertTransferEnvelope,
  getTransferAttachmentReferences,
  mergeTransferEnvelopes,
  transferIdentityKey,
} from "../src/index.js";
import { decideTransfer } from "../src/policy.js";

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

test("creates a source reference envelope without persisting an attachment", () => {
  const envelope = sourceReferenceTransfer({
    transferId: "tr-source",
    messageId: "m-source",
    identity,
    direction: "output",
    reference: {
      address: "/workspace/u/runtime/ops_workdir/a.txt",
      name: "a.txt",
      startLine: 1,
      endLine: 10,
    },
    intent: {
      source: "tool",
      reason: "read_file_source_reference",
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  assert.equal(envelope.payload.mode, "source_reference");
  assert.equal(envelope.payload.reference.address, "/workspace/u/runtime/ops_workdir/a.txt");
  assert.equal(validateTransferEnvelope(envelope).ok, true);
});

test("creates a source reference envelope for a canonical attachment identity", () => {
  const address = {
    attachmentId: "attachment-source-1",
    sessionId: "session-source-1",
    attachmentSource: "model",
  };
  const envelope = sourceReferenceTransfer({
    transferId: "tr-attachment-source",
    messageId: "m-attachment-source",
    identity,
    direction: "output",
    reference: { address, name: "result.txt", startLine: 1, endLine: 400 },
    intent: {
      source: "tool",
      reason: "read_file_source_reference",
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  assert.deepEqual(envelope.payload.reference.address, address);
  assert.equal(validateTransferEnvelope(envelope).ok, true);
});

test("rejects inferred or incomplete attachment source addresses", () => {
  assert.throws(() =>
    sourceReferenceTransfer({
      transferId: "tr-invalid-source",
      messageId: "m-invalid-source",
      identity,
      direction: "output",
      reference: { address: { attachmentId: "attachment-source-1" }, name: "result.txt" },
      intent: {
        source: "tool",
        reason: "read_file_source_reference",
        scenario: "tool",
        strategy: "tool_output",
      },
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

test("rejects unregistered scenarios and strategies", () => {
  assert.throws(
    () => assertSemanticTransferRegistration({ scenario: "unknown", strategy: "tool_output" }),
    /semantic_transfer_scenario_not_registered/,
  );
  assert.throws(
    () => assertSemanticTransferRegistration({ scenario: "tool", strategy: "unknown" }),
    /semantic_transfer_strategy_not_registered/,
  );
  assert.throws(
    () =>
      directTransfer({
        transferId: "tr-unregistered",
        messageId: "m-unregistered",
        identity,
        direction: "output",
        intent: { source: "tool", reason: "test", scenario: "tool", strategy: "unknown" },
        content: "blocked",
      }),
    /semantic_transfer_strategy_not_registered/,
  );
});

test("enforces registered flow categories and business points", () => {
  assert.doesNotThrow(() =>
    assertSemanticTransferRegistration({
      scenario: "harness",
      strategy: "harness_acceptance",
      category: "acceptance",
      businessPoint: "acceptance_report",
    }),
  );
  assert.throws(
    () =>
      assertSemanticTransferRegistration({
        scenario: "harness",
        strategy: "harness_summary",
        category: "guidance",
        businessPoint: "ordinary_guidance",
      }),
    /semantic_transfer_business_point_not_registered/,
  );
});

test("tool input and output policies come from the protocol registry", () => {
  assert.equal(hasToolInputPolicy("write_file"), true);
  assert.equal(getToolInputPolicy("write_file").field, "content");
  assert.equal(getToolOutputPolicy("write_file").type, "text");
  assert.equal(getToolOutputPolicy("multimodal_generate").type, "attachment_bytes");
  assert.throws(() => getToolInputPolicy("unknown"), /tool_input_policy_not_registered/);
  assert.throws(() => getToolOutputPolicy("unknown"), /tool_output_policy_not_registered/);
});


test("strict validation rejects unregistered incoming semantics", () => {
  const envelope = directTransfer({
    transferId: "strict-registration",
    messageId: "m-strict-registration",
    identity,
    direction: "output",
    intent: { source: "tool", reason: "test", scenario: "tool", strategy: "tool_output" },
    content: "ok",
  });
  const invalid = { ...envelope, intent: { ...envelope.intent, strategy: "unknown" } };
  assert.throws(() => assertTransferEnvelope(invalid), /semantic_transfer_strategy_not_registered/);
});

test("transfer identity key is unambiguous", () => {
  assert.notEqual(
    transferIdentityKey({ transferId: "a:b", messageId: "c" }),
    transferIdentityKey({ transferId: "a", messageId: "b:c" }),
  );
});

test("mergeTransferEnvelopes is ordered, idempotent, and rejects identity conflicts", () => {
  const envelope = directTransfer({
    transferId: "merge-1",
    messageId: "merge-message",
    identity,
    direction: "output",
    intent: { source: "tool", reason: "test", scenario: "tool", strategy: "tool_output" },
    content: "same",
  });
  assert.deepEqual(mergeTransferEnvelopes([envelope], envelope), [envelope]);
  assert.throws(
    () => mergeTransferEnvelopes(envelope, { ...envelope, payload: { ...envelope.payload, content: "different" } }),
    /transfer_identity_conflict/,
  );
});

test("attachment references have one canonical conflict-aware projection", () => {
  const envelope = attachmentTransfer({
    transferId: "refs-1",
    messageId: "refs-message",
    identity,
    direction: "output",
    intent: { source: "tool", reason: "test", scenario: "tool", strategy: "tool_output" },
    attachments: [{
      identity: { attachmentId: "ref-1", sessionId: "s1", attachmentSource: "model" },
      name: "result.txt",
    }],
  });
  assert.equal(getTransferAttachmentReferences([envelope, envelope]).length, 1);
});
