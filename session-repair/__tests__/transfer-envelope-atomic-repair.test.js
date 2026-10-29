/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TRANSFER_ENVELOPE_V2, TRANSFER_REASON } from "@noobot/semantic-transfer-protocol";
import {
  SESSION_REPAIR_DATA_REJECTION_CODES,
  SESSION_REPAIR_ERROR_CODE,
  isOwnedSessionRepairTempDirectoryName,
  isSessionRepairTempDirectoryName,
  migrateSessionDocument,
  runAtomicSessionRepair,
} from "../src/index.js";
import { historicalMultimodalParseEnvelope } from "./helpers/transfer-envelope.js";

function legacyV2Envelope(overrides = {}) {
  const { presentationMessageId, ...rest } = historicalMultimodalParseEnvelope({
    intent: {
      source: "tool",
      reason: TRANSFER_REASON.MULTIMODAL_PARSE_ARTIFACT,
      scenario: "tool",
      strategy: "tool_result_text",
    },
  });
  return {
    ...rest,
    version: 2,
    [TRANSFER_ENVELOPE_V2.presentationField]: presentationMessageId,
    ...overrides,
  };
}

function sessionWithEnvelope(envelope) {
  return {
    schemaVersion: 2,
    sessionId: "session-1",
    aggregateVersion: 2,
    turnTimings: [],
    turnLifecycle: { turns: {}, commandReceipts: [] },
    messages: [
      { messageUid: "assistant-1", role: "assistant", content: "", transferEnvelopes: [envelope] },
    ],
  };
}

test("upgrades legacy v2 transfer envelopes before strict validation", () => {
  const result = migrateSessionDocument(sessionWithEnvelope(legacyV2Envelope()));
  const [envelope] = result.document.messages[0].transferEnvelopes;
  assert.equal(envelope.version, 3);
  assert.equal(envelope.presentationMessageId, "msg_presentation-1");
  assert.equal(Object.hasOwn(envelope, TRANSFER_ENVELOPE_V2.presentationField), false);
  assert.equal(result.changed, true);
});

test("rejects unmigratable transfer envelopes with an isolatable data code", () => {
  const session = sessionWithEnvelope(
    legacyV2Envelope({ [TRANSFER_ENVELOPE_V2.presentationField]: "not-a-presentation-id" }),
  );
  assert.throws(
    () => migrateSessionDocument(session),
    (error) =>
      error.code === SESSION_REPAIR_ERROR_CODE.TRANSFER_ENVELOPE_UNMIGRATABLE &&
      SESSION_REPAIR_DATA_REJECTION_CODES.includes(error.code),
  );
});

test("atomic swap failures are not data rejections", () => {
  assert.equal(
    SESSION_REPAIR_DATA_REJECTION_CODES.includes(SESSION_REPAIR_ERROR_CODE.ATOMIC_SWAP_FAILED),
    false,
  );
});

test("repair temp directory names are recognized", () => {
  assert.equal(isSessionRepairTempDirectoryName("s1.repair-backup-abc"), true);
  assert.equal(isSessionRepairTempDirectoryName("s1.repair-staging-abc"), true);
  assert.equal(isSessionRepairTempDirectoryName("44d9a0d8-7bfc-4bd6-903d-2a16aca7d793"), false);
});

test("owned repair temp directory names only match their own session directory", () => {
  assert.equal(isOwnedSessionRepairTempDirectoryName("s1.repair-staging-abc", "s1"), true);
  assert.equal(isOwnedSessionRepairTempDirectoryName("s1.repair-backup-abc", "s1"), true);
  assert.equal(isOwnedSessionRepairTempDirectoryName("s2.repair-staging-abc", "s1"), false);
  assert.equal(isOwnedSessionRepairTempDirectoryName("s1.staging-abc", "s1"), false);
});

test("atomic repair preserves staging and backup when swap and rollback both fail", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noobot-session-repair-"));
  const sessionDir = path.join(root, "session-1");
  await mkdir(sessionDir);
  await writeFile(path.join(sessionDir, "session.json"), "original", "utf8");
  const removed = [];
  let renames = 0;
  const fs = {
    cp,
    rm: async (target, options) => {
      removed.push(target);
      return rm(target, options);
    },
    rename: async (from, to) => {
      renames += 1;
      if (renames === 1) return rename(from, to);

      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    },
  };
  try {
    await assert.rejects(
      runAtomicSessionRepair({
        sessionDir,
        fs,
        repair: async (stagingDir) =>
          writeFile(path.join(stagingDir, "session.json"), "changed", "utf8"),
        validate: async () => {},
      }),
      (error) =>
        error.code === SESSION_REPAIR_ERROR_CODE.ATOMIC_SWAP_FAILED &&
        Boolean(error.details?.stagingDir && error.details?.backupDir),
    );
    assert.deepEqual(removed, []);
    const names = await readdir(root);
    const backup = names.find((name) => name.includes(".repair-backup-"));
    const staging = names.find((name) => name.includes(".repair-staging-"));
    assert.equal(await readFile(path.join(root, backup, "session.json"), "utf8"), "original");
    assert.equal(await readFile(path.join(root, staging, "session.json"), "utf8"), "changed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
