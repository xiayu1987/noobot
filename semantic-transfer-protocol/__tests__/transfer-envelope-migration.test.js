/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSFER_REASON,
  TRANSFER_VERSION,
  assertTransferEnvelope,
  directTransfer,
  TRANSFER_DOCUMENT_FORMAT,
  upgradeTransferEnvelope,
  upgradeTransferEnvelopesInDocumentText,
  upgradeTransferEnvelopesInValue,
} from "../src/index.js";

function currentEnvelope() {
  return directTransfer({
    transferId: "transfer:1",
    presentationMessageId: "msg_presentation-1",
    identity: {
      sessionId: "session-1",
      turnScopeId: "turn-1",
      runId: "run-1",
      producer: { type: "tool", id: "call-1" },
    },
    direction: "output",
    content: "hello",
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_RESULT,
      scenario: "tool",
      strategy: "tool_output",
    },
  });
}

function legacyV2Envelope() {
  const { presentationMessageId, ...rest } = structuredClone(currentEnvelope());
  return { ...rest, version: 2, messageId: presentationMessageId };
}

test("upgrades a v2 envelope by renaming messageId to presentationMessageId", () => {
  const upgraded = upgradeTransferEnvelope(legacyV2Envelope());
  assert.equal(TRANSFER_VERSION, 3);
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.presentationMessageId, "msg_presentation-1");
  assert.equal(Object.hasOwn(upgraded, "messageId"), false);
  assert.deepEqual(upgraded, structuredClone(currentEnvelope()));
  assertTransferEnvelope(upgraded);
});

test("returns a current envelope unchanged", () => {
  const envelope = currentEnvelope();
  assert.equal(upgradeTransferEnvelope(envelope), envelope);
});

test("rejects a v2 envelope that already carries presentationMessageId", () => {
  const envelope = { ...legacyV2Envelope(), presentationMessageId: "msg_presentation-1" };
  assert.throws(() => upgradeTransferEnvelope(envelope), /v2_has_presentation_message_id/);
});

test("rejects a v2 envelope whose messageId is not a presentation message id", () => {
  const envelope = { ...legacyV2Envelope(), messageId: "sm_session-uid" };
  assert.throws(() => upgradeTransferEnvelope(envelope), /v2_message_id_not_presentation_id/);
});

test("rejects unsupported envelope versions", () => {
  assert.throws(
    () => upgradeTransferEnvelope({ ...legacyV2Envelope(), version: 1 }),
    /unsupported_version/,
  );
  assert.throws(() => upgradeTransferEnvelope({ version: 3 }), /not_transfer_envelope/);
});

test("upgrades nested envelopes and reports the count", () => {
  const value = { a: [legacyV2Envelope(), { b: legacyV2Envelope() }], c: "x" };
  const result = upgradeTransferEnvelopesInValue(value);
  assert.equal(result.upgraded, 2);
  assert.deepEqual(result.value.a[0], structuredClone(currentEnvelope()));
  assert.deepEqual(result.value.a[1].b, structuredClone(currentEnvelope()));
  assert.equal(result.value.c, "x");
});

test("returns the same value when no envelope needs upgrading", () => {
  const value = { a: [currentEnvelope()], b: 1 };
  const result = upgradeTransferEnvelopesInValue(value);
  assert.equal(result.upgraded, 0);
  assert.equal(result.value, value);
});

test("rewrites only JSONL lines that carry legacy envelopes", () => {
  const untouched = JSON.stringify({ k: 1 }, null, 0).replace(":", ": ");
  const text = [untouched, JSON.stringify({ e: legacyV2Envelope() }), ""].join("\n");
  const result = upgradeTransferEnvelopesInDocumentText({
    text,
    format: TRANSFER_DOCUMENT_FORMAT.JSONL,
  });
  const lines = result.text.split("\n");
  assert.equal(result.upgraded, 1);
  assert.equal(lines[0], untouched);
  assert.equal(JSON.parse(lines[1]).e.version, 3);
  assert.equal(lines[2], "");
});

test("returns null text for documents without legacy envelopes", () => {
  const text = JSON.stringify({ e: currentEnvelope() });
  for (const format of Object.values(TRANSFER_DOCUMENT_FORMAT)) {
    assert.deepEqual(upgradeTransferEnvelopesInDocumentText({ text, format }), {
      text: null,
      upgraded: 0,
    });
  }
});

test("rejects unparseable documents and unknown formats", () => {
  assert.throws(() =>
    upgradeTransferEnvelopesInDocumentText({ text: "{bad", format: TRANSFER_DOCUMENT_FORMAT.JSON }),
  );
  assert.throws(() =>
    upgradeTransferEnvelopesInDocumentText({
      text: "{}\n{bad",
      format: TRANSFER_DOCUMENT_FORMAT.JSONL,
    }),
  );
  assert.throws(
    () => upgradeTransferEnvelopesInDocumentText({ text: "{}", format: "yaml" }),
    TypeError,
  );
});
