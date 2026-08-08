/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateTransferEnvelope } from "@noobot/semantic-transfer-protocol";
import {
  migrateSessionDocument,
  reconcileExecutionSegmentIndex,
  runAtomicSessionRepair,
} from "../src/index.mjs";

function legacyMessage() {
  return {
    messageUid: "sm-1",
    messageId: "message-1",
    role: "assistant",
    turnScopeId: "turn-1",
    dialogProcessId: "dialog-1",
    transferEnvelopes: [{
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [{
        attachmentId: "attachment-1",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "result.md",
        mimeType: "text/markdown",
        size: 12,
        relativePath: "runtime/attach/result.md",
        path: "/host/result.md",
      }],
    }],
  };
}

test("migrates Semantic Transfer V1 into the one strict V2 envelope", () => {
  const result = migrateSessionDocument({ sessionId: "session-1", messages: [legacyMessage()] });
  assert.equal(result.changed, true);
  const envelope = result.document.messages[0].transferEnvelopes[0];
  assert.equal(envelope.version, 2);
  assert.equal(validateTransferEnvelope(envelope, { strict: true }).ok, true);
  assert.deepEqual(envelope.payload.attachments[0].identity, {
    attachmentId: "attachment-1",
    sessionId: "session-1",
    attachmentSource: "model",
  });
  assert.equal(JSON.stringify(envelope).includes("relativePath"), false);
  assert.equal(JSON.stringify(envelope).includes("/host/result.md"), false);
});

test("migrates nested workflow transfer collections with attachmentMeta V1 records", () => {
  const message = legacyMessage();
  message.pluginMeta = {
    payload: {
      nodeResultTransferEnvelopes: [{
        protocol: "noobot.semantic-transfer",
        version: 1,
        direction: "output",
        transport: "file",
        files: [{
          filePath: "/workspace/result.md",
          attachmentMeta: {
            attachmentId: "nested-attachment",
            sessionId: "session-1",
            attachmentSource: "model",
            name: "nested.md",
            mimeType: "text/markdown",
          },
        }],
      }],
    },
  };
  const result = migrateSessionDocument({ sessionId: "session-1", messages: [message] });
  const envelope = result.document.messages[0].pluginMeta.payload.nodeResultTransferEnvelopes[0];
  assert.equal(validateTransferEnvelope(envelope, { strict: true }).ok, true);
  assert.equal(envelope.payload.attachments[0].identity.attachmentId, "nested-attachment");
  assert.equal(JSON.stringify(envelope).includes("filePath"), false);
});

test("rejects a legacy transfer that cannot recover canonical Turn identity", () => {
  const message = legacyMessage();
  delete message.turnScopeId;
  assert.throws(
    () => migrateSessionDocument({ sessionId: "session-1", messages: [message] }),
    (error) => error.code === "SESSION_TRANSFER_V1_IDENTITY_REQUIRED",
  );
});

test("reconciles execution index metadata through one repair function", () => {
  const result = reconcileExecutionSegmentIndex(
    { segments: [{ file: "segment-1.jsonl", bytes: 1, records: 1 }] },
    [{ file: "segment-1.jsonl", bytes: 20, records: 2 }],
  );
  assert.deepEqual(result.repaired, ["segment-1.jsonl"]);
  assert.deepEqual(result.index.segments[0], { file: "segment-1.jsonl", bytes: 20, records: 2 });
});

test("atomic repair leaves the authoritative directory unchanged when validation fails", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-"));
  const sessionDir = path.join(root, "session-1");
  await mkdir(sessionDir);
  await writeFile(path.join(sessionDir, "session.json"), "original", "utf8");
  try {
    await assert.rejects(runAtomicSessionRepair({
      sessionDir,
      repair: async (stagingDir) => writeFile(path.join(stagingDir, "session.json"), "changed", "utf8"),
      validate: async () => { throw new Error("invalid"); },
    }));
    assert.equal(await readFile(path.join(sessionDir, "session.json"), "utf8"), "original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
