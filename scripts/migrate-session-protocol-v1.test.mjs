/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationScript = path.join(repositoryRoot, "scripts/migrate-session-protocol-v1.mjs");

function runMigration(workspaceRoot, backupRoot, ...args) {
  return JSON.parse(execFileSync(process.execPath, [
    migrationScript,
    `--workspace=${workspaceRoot}`,
    `--backup=${backupRoot}`,
    ...args,
  ], { encoding: "utf8" }));
}

test("migrates entity message identity without creating an identity for presentation projections", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-session-protocol-migration-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const backupRoot = path.join(temporaryRoot, "backup");
  const sessionDirectory = path.join(workspaceRoot, "user", "runtime", "session", "session-1");
  const summaryFile = path.join(sessionDirectory, "session-summary.json");
  fs.mkdirSync(sessionDirectory, { recursive: true });
  fs.writeFileSync(summaryFile, `${JSON.stringify({
    sessionId: "session-1",
    messages: [
      { role: "user", messageId: "message-1", content: "source" },
      {
        role: "assistant",
        chatPresentation: true,
        presentationMessageId: "presentation-1",
        messageId: "presentation-1",
        sourceMessageId: "message-2",
        sourceMessageUid: "sm_source_2",
        content: "projection",
      },
      {
        role: "assistant",
        chatPresentation: true,
        presentationMessageId: "presentation-2",
        messageId: "presentation-2",
        messageUid: "sm_invalid_projection_identity",
        sourceMessageId: "message-3",
        sourceMessageUid: "sm_source_3",
        content: "projection with an invalid second identity",
      },
    ],
  }, null, 2)}\n`);

  try {
    const dryRun = runMigration(workspaceRoot, backupRoot);
    assert.equal(dryRun.filesChanged, 1);
    assert.equal(dryRun.written, false);

    const written = runMigration(workspaceRoot, backupRoot, "--write");
    assert.equal(written.filesChanged, 1);
    assert.equal(written.written, true);

    const migrated = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
    assert.match(migrated.messages[0].messageUid, /^sm_migrated_[a-f0-9]{32}$/);
    assert.equal("messageUid" in migrated.messages[1], false);
    assert.equal(migrated.messages[1].sourceMessageUid, "sm_source_2");
    assert.equal("messageUid" in migrated.messages[2], false);
    assert.equal(migrated.messages[2].sourceMessageUid, "sm_source_3");

    const converged = runMigration(workspaceRoot, path.join(temporaryRoot, "unused-backup"));
    assert.equal(converged.filesChanged, 0);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
