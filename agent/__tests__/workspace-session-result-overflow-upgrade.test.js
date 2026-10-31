/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sourceReferenceTransfer, attachmentTransfer } from "@noobot/semantic-transfer-protocol";
import {
  migrateOverflowResultText,
  upgradeSessionResultOverflow,
} from "../src/workspace-lifecycle/session-result-overflow-upgrade.js";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SESSION_ARTIFACT_SCHEMA_VERSION } from "@noobot/session-protocol";
import { messageHash } from "../src/session/session-artifact-session/turn-journal-store.js";

function source(
  reference = {
    address: "/tmp/large.txt",
    name: "large.txt",
    startLine: 1,
    endLine: 5000,
    totalLines: 60000,
  },
) {
  return sourceReferenceTransfer({
    transferId: "transfer-1",
    presentationMessageId: "presentation-1",
    identity: { sessionId: "s1", turnScopeId: "t1", producer: { type: "tool", id: "c1" } },
    direction: "output",
    reference,
    intent: {
      source: "tool",
      reason: "read_file_source_reference",
      scenario: "tool",
      strategy: "tool_output",
    },
  });
}

const encode = JSON.stringify;

test("v25 entry rewrites committed journal hashes without retained backups and is idempotent", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "overflow-v25-"));
  try {
    const dir = path.join(base, "runtime/session/s1");
    await mkdir(path.join(dir, "turns"), { recursive: true });
    const message = {
      role: "tool",
      type: "tool_result",
      messageUid: "m1",
      turnScopeId: "t1",
      tool_call_id: "c1",
      transferEnvelopes: [source()],
      content: encode({ ok: true, overflowed: true, message: "read source" }),
    };
    const record = { op: "upsert", messageUid: "m1", message, hash: messageHash(message) };
    const journal = `${encode(record)}\n`;
    const manifest = {
      schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
      turnOrder: [
        {
          turnId: "turn-000001",
          committedBytes: Buffer.byteLength(journal),
          summarySnapshots: [],
          messageHashes: { m1: record.hash },
        },
      ],
    };
    await writeFile(path.join(dir, "session.json"), encode(manifest));
    const journalPath = path.join(dir, "turns/turn-000001.jsonl");
    await writeFile(journalPath, journal);
    const options = { base, scopedSessionRoots: ["runtime/agent/session"] };
    const report = await upgradeSessionResultOverflow(options);
    assert.deepEqual(report.quarantined, []);
    assert.equal(report.sessions.length, 1);
    const next = JSON.parse(await readFile(journalPath, "utf8"));
    assert.deepEqual(JSON.parse(next.message.content).transferEnvelopes, [source()]);
    assert.equal(next.hash, messageHash(next.message));
    const updated = JSON.parse(await readFile(path.join(dir, "session.json"), "utf8"));
    assert.equal(updated.turnOrder[0].messageHashes.m1, next.hash);
    assert.equal(
      updated.turnOrder[0].committedBytes,
      Buffer.byteLength(await readFile(journalPath)),
    );
    assert.deepEqual(await readdir(base), ["runtime"]);
    assert.deepEqual(await upgradeSessionResultOverflow(options), {
      sessions: [],
      quarantined: [],
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("v25 preserves source continuation references and is idempotent", () => {
  const envelope = source();
  const migrated = migrateOverflowResultText(
    encode({
      ok: true,
      overflowed: true,
      message: "read source",
      sourceReferences: [
        { filePath: "/tmp/large.txt", startLine: 1, endLine: 5000, totalLines: 60000 },
      ],
    }),
    [envelope],
  );
  assert.deepEqual(JSON.parse(migrated), {
    ok: true,
    overflowed: true,
    message: "read source",
    transferEnvelopes: [envelope],
  });
  assert.equal(migrateOverflowResultText(migrated), null);
});

test("v25 rejects missing or mismatched source references", () => {
  const envelope = source();
  const text = encode({
    ok: true,
    overflowed: true,
    message: "read source",
    sourceReferences: [
      {
        filePath: envelope.payload.reference.address,
        startLine: 1,
        endLine: 5000,
        totalLines: 60000,
      },
    ],
  });
  for (const transfers of [[], [source({ address: "/tmp/other.txt", name: "other.txt" })]]) {
    assert.throws(() => migrateOverflowResultText(text, transfers), /source_transfer_missing/);
  }
});

test("v25 rejects conflicting authoritative transfer facts", () => {
  assert.throws(
    () =>
      migrateOverflowResultText(
        encode({
          ok: true,
          overflowed: true,
          outputOverflow: true,
          message: "read source",
          transferEnvelopes: [source()],
        }),
        [source({ address: "/tmp/other.txt", name: "other.txt" })],
      ),
    { code: "transfer_identity_conflict" },
  );
});

test("v25 preserves script attachment identity, errors and background delivery", () => {
  const envelope = attachmentTransfer({
    transferId: "transfer-2",
    presentationMessageId: "presentation-1",
    identity: { sessionId: "s1", turnScopeId: "t1", producer: { type: "tool", id: "c1" } },
    direction: "output",
    attachments: [
      {
        identity: { attachmentId: "a1", sessionId: "s1", attachmentSource: "model" },
        name: "stdout.txt",
        mimeType: "text/plain",
      },
    ],
    intent: {
      source: "tool",
      reason: "execute_script_output_overflow",
      scenario: "tool",
      strategy: "tool_output",
    },
  });
  const legacy = {
    ok: false,
    code: "RECOVERABLE_SCRIPT_NON_ZERO_EXIT",
    error: "script exited with code 3",
    exitCode: 3,
    outputOverflow: true,
    outputDelivery: "attachment",
    outputTransferReason: "execute_script_output_overflow",
    attachmentRefs: ["attachment:v1:s1/model/a1"],
    message: "read output",
  };
  const result = JSON.parse(migrateOverflowResultText(encode(legacy), [envelope]));
  assert.deepEqual(result, {
    ok: false,
    code: legacy.code,
    error: legacy.error,
    exitCode: 3,
    overflowed: true,
    message: "read output",
    transferEnvelopes: [envelope],
  });
  assert.throws(() => migrateOverflowResultText(encode(legacy)), /attachment_transfer_missing/);
  const background = JSON.parse(
    migrateOverflowResultText(encode({ ...legacy, outputOverflow: false }), [envelope]),
  );
  assert.equal(Object.hasOwn(background, "overflowed"), false);
  assert.deepEqual(background.transferEnvelopes, [envelope]);
});
